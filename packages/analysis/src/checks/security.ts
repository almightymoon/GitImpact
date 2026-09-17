import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CheckFinding, ParsedFile } from "@gitimpact/shared";

function finding(
  partial: Omit<CheckFinding, "id" | "confidence"> & { confidence?: CheckFinding["confidence"] },
): CheckFinding {
  return {
    confidence: "MEDIUM",
    ...partial,
    id: `${partial.ruleId}:${partial.file ?? "repo"}:${partial.startLine ?? 0}:${partial.symbolName ?? partial.title}`,
  };
}

/** Hard-coded secret-like patterns (deterministic; may false-positive on placeholders). */
const SECRET_LINE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    label: "Hard-coded credential assignment",
  },
  {
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    label: "Private key material in source",
  },
  {
    re: /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/,
    label: "GitHub personal access token pattern",
  },
  {
    re: /AKIA[0-9A-Z]{16}/,
    label: "AWS access key id pattern",
  },
  {
    re: /xox[baprs]-[0-9A-Za-z-]{10,}/,
    label: "Slack token pattern",
  },
];

const DANGEROUS_DEPS: Array<{ name: RegExp; reason: string }> = [
  { name: /^eval$/, reason: "Avoid eval-based packages" },
  { name: /^node-uuid$/, reason: "Deprecated; prefer uuid package" },
  { name: /^request$/, reason: "Deprecated HTTP client with known maintenance risk" },
  { name: /^serialize-javascript$/, reason: "Historically XSS-sensitive when misused" },
];

export async function runSecurityChecks(input: {
  files: ParsedFile[];
  contentsByPath: Map<string, string>;
  packageDeps?: Record<string, string>;
  clonePath?: string;
  allRelativeFiles?: string[];
}): Promise<CheckFinding[]> {
  const findings: CheckFinding[] = [];

  for (const file of input.files) {
    const content = input.contentsByPath.get(file.path);
    if (!content) continue;
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/process\.env\.[A-Z0-9_]+/.test(line) && /fallback|default.*=.*['"]/.test(line)) {
        // soft signal only when literal secret-looking default
        if (/['"][^'"]{12,}['"]/.test(line) && /secret|token|key|password/i.test(line)) {
          findings.push(
            finding({
              ruleId: "unsafe_env_handling",
              category: "security",
              severity: "medium",
              title: "Environment secret with literal default",
              message:
                "A secret-like environment variable appears to fall back to a literal string. Prefer failing closed when unset.",
              file: file.path,
              startLine: i + 1,
              evidence: line.trim().slice(0, 160),
              confidence: "MEDIUM",
            }),
          );
        }
      }

      for (const pattern of SECRET_LINE_PATTERNS) {
        if (!pattern.re.test(line)) continue;
        // Skip obvious placeholders
        if (/your[_-]?api[_-]?key|changeme|xxx+|placeholder|example\.com|TODO/i.test(line)) {
          continue;
        }
        findings.push(
          finding({
            ruleId: "secret_exposure",
            category: "security",
            severity: "critical",
            title: pattern.label,
            message:
              "Possible secret material detected in source. Rotate credentials if real and move secrets to a vault or environment configuration.",
            file: file.path,
            startLine: i + 1,
            evidence: line.trim().slice(0, 120),
            confidence: "HIGH",
          }),
        );
      }

      // Suspicious input handling: req.body / query used without obvious validation nearby
      if (
        /\b(req|request)\.(body|query|params)\b/.test(line) &&
        /\beval\s*\(|new Function\s*\(|child_process|execSync|exec\(/.test(line)
      ) {
        findings.push(
          finding({
            ruleId: "suspicious_input_handling",
            category: "security",
            severity: "high",
            title: "User input reaches a dangerous sink",
            message:
              "Request input appears on the same line as eval/exec-style APIs. Validate and sanitize before use.",
            file: file.path,
            startLine: i + 1,
            evidence: line.trim().slice(0, 160),
            confidence: "HIGH",
          }),
        );
      }
    }

    // Auth-sensitive file naming / symbols
    if (/auth|session|jwt|password|oauth/i.test(file.path)) {
      const authFns = [
        ...file.functions.filter((f) => /auth|login|password|token|session/i.test(f.name)),
        ...file.classes.flatMap((c) =>
          c.methods
            .filter((m) => /auth|login|password|token|session/i.test(m.name))
            .map((m) => ({ name: `${c.name}.${m.name}`, startLine: m.startLine })),
        ),
      ];
      for (const fn of authFns.slice(0, 5)) {
        const name = "name" in fn ? fn.name : (fn as { name: string }).name;
        findings.push(
          finding({
            ruleId: "insecure_auth_pattern",
            category: "security",
            severity: "info",
            title: "Authentication-sensitive code",
            message: `${name} lives in an auth-related path. Review carefully on change — not a confirmed vulnerability.`,
            file: file.path,
            startLine: "startLine" in fn ? fn.startLine : undefined,
            symbolName: name,
            confidence: "LOW",
          }),
        );
      }
    }

    // JWT without algorithm / verify patterns (heuristic)
    if (/jsonwebtoken|jwt\.sign|jwt\.verify/i.test(content)) {
      if (/jwt\.verify\([^)]*\{[^}]*algorithms\s*:\s*\[\s*['"]none['"]/i.test(content)) {
        findings.push(
          finding({
            ruleId: "insecure_auth_pattern",
            category: "security",
            severity: "critical",
            title: "JWT verify allows none algorithm",
            message: "JWT verification appears to allow the 'none' algorithm, which is unsafe.",
            file: file.path,
            confidence: "HIGH",
          }),
        );
      }
    }
  }

  // Dangerous dependency names
  for (const [dep] of Object.entries(input.packageDeps ?? {})) {
    for (const danger of DANGEROUS_DEPS) {
      if (danger.name.test(dep)) {
        findings.push(
          finding({
            ruleId: "dangerous_dependency",
            category: "dependencies",
            severity: "medium",
            title: `Risky dependency: ${dep}`,
            message: danger.reason,
            file: "package.json",
            evidence: dep,
            confidence: "MEDIUM",
          }),
        );
      }
    }
  }

  // .env committed
  for (const rel of input.allRelativeFiles ?? []) {
    if (/(^|\/)\.env($|\.)/.test(rel) && !/\.example$|\.sample$|\.template$/i.test(rel)) {
      findings.push(
        finding({
          ruleId: "secret_exposure",
          category: "security",
          severity: "high",
          title: "Environment file present in repository",
          message: `${rel} may contain secrets. Prefer .env.example committed and real .env gitignored.`,
          file: rel,
          confidence: "MEDIUM",
        }),
      );
    }
  }

  // Scan a few infra/config files for AWS keys etc. when clone available
  if (input.clonePath) {
    const candidates = (input.allRelativeFiles ?? [])
      .filter((p) => /\.(ya?ml|env|json|tf|toml)$/i.test(p) && !/node_modules|package-lock|pnpm-lock/.test(p))
      .slice(0, 40);
    for (const rel of candidates) {
      try {
        const raw = await readFile(path.join(input.clonePath, rel), "utf8");
        for (const pattern of SECRET_LINE_PATTERNS) {
          if (pattern.re.test(raw) && !/changeme|example|placeholder/i.test(raw)) {
            findings.push(
              finding({
                ruleId: "secret_exposure",
                category: "security",
                severity: "high",
                title: pattern.label,
                message: `Possible secret material in ${rel}.`,
                file: rel,
                confidence: "MEDIUM",
              }),
            );
            break;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return dedupeFindings(findings);
}

export function markAuthSensitiveChanges(
  findings: CheckFinding[],
  changedFiles: string[],
): CheckFinding[] {
  const extra: CheckFinding[] = [];
  for (const file of changedFiles) {
    if (!/auth|session|jwt|password|oauth|middleware\/auth/i.test(file)) continue;
    extra.push(
      finding({
        ruleId: "auth_sensitive_change",
        category: "security",
        severity: "info",
        title: "Authentication-sensitive code changed",
        message: `${file} changed in this PR and relates to authentication or session handling.`,
        file,
        confidence: "MEDIUM",
      }),
    );
  }
  return dedupeFindings([...findings, ...extra]);
}

function dedupeFindings(findings: CheckFinding[]): CheckFinding[] {
  const seen = new Set<string>();
  const out: CheckFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}
