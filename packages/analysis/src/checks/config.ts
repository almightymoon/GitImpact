import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  CheckFinding,
  CheckRuleId,
  CheckSeverity,
  GitImpactConfig,
} from "@gitimpact/shared";

const SEVERITIES: CheckSeverity[] = ["critical", "high", "medium", "low", "info"];

export async function loadGitImpactConfig(
  clonePath?: string,
): Promise<{ config: GitImpactConfig | null; path?: string }> {
  if (!clonePath) return { config: null };
  const candidates = [".gitimpact.yml", ".gitimpact.yaml", ".gitimpact.json"];
  for (const name of candidates) {
    const full = path.join(clonePath, name);
    try {
      const raw = await readFile(full, "utf8");
      const parsed =
        name.endsWith(".json")
          ? (JSON.parse(raw) as GitImpactConfig)
          : (parseYaml(raw) as GitImpactConfig);
      if (!parsed || typeof parsed !== "object") continue;
      return { config: parsed, path: name };
    } catch {
      // try next
    }
  }
  return { config: null };
}

/** Simple glob: `*` within a segment, `**` across segments. */
export function matchPathGlob(filePath: string, pattern: string): boolean {
  const file = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const glob = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!glob.includes("*") && !glob.includes("?")) {
    return file === glob || file.startsWith(glob.replace(/\/$/, "") + "/");
  }

  let i = 0;
  let re = "^";
  while (i < glob.length) {
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 3;
    } else if (glob.startsWith("**", i)) {
      re += ".*";
      i += 2;
    } else if (glob[i] === "*") {
      re += "[^/]*";
      i += 1;
    } else if (glob[i] === "?") {
      re += "[^/]";
      i += 1;
    } else {
      const ch = glob[i]!;
      re += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
      i += 1;
    }
  }
  re += "$";
  try {
    return new RegExp(re).test(file);
  } catch {
    return false;
  }
}

function isSeverity(value: unknown): value is CheckSeverity {
  return typeof value === "string" && (SEVERITIES as string[]).includes(value);
}

export function applyChecksConfig(
  findings: CheckFinding[],
  config: GitImpactConfig | null,
): {
  findings: CheckFinding[];
  suppressed: number;
  severityOverrides: number;
} {
  if (!config?.checks) {
    return { findings, suppressed: 0, severityOverrides: 0 };
  }

  const ignore = config.checks.ignore ?? [];
  const severityMap = config.checks.severity ?? {};

  let suppressed = 0;
  let severityOverrides = 0;

  const kept: CheckFinding[] = [];
  for (const finding of findings) {
    const hit = ignore.find((rule) => {
      if (rule.rule !== finding.ruleId && rule.rule !== "*") return false;
      if (!rule.path) return true;
      if (!finding.file) return false;
      return matchPathGlob(finding.file, rule.path);
    });
    if (hit) {
      suppressed += 1;
      continue;
    }

    const override = severityMap[finding.ruleId as CheckRuleId] ?? severityMap[finding.ruleId];
    if (isSeverity(override) && override !== finding.severity) {
      severityOverrides += 1;
      kept.push({ ...finding, severity: override });
    } else {
      kept.push(finding);
    }
  }

  return { findings: kept, suppressed, severityOverrides };
}
