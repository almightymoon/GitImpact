import type {
  CheckFinding,
  ChangeRecord,
  InfraSignal,
} from "@gitimpact/shared";

function finding(
  partial: Omit<CheckFinding, "id" | "confidence"> & { confidence?: CheckFinding["confidence"] },
): CheckFinding {
  return {
    confidence: "HIGH",
    ...partial,
    id: `${partial.ruleId}:${partial.file ?? "repo"}:${partial.title}`,
  };
}

const PATH_RULES: Array<{
  test: (p: string) => boolean;
  ruleId: CheckFinding["ruleId"];
  category: CheckFinding["category"];
  title: string;
  message: string;
  presentRuleId?: CheckFinding["ruleId"];
}> = [
  {
    test: (p) => /(^|\/)\.github\/workflows\//.test(p),
    ruleId: "github_actions_changed",
    presentRuleId: "github_actions_present",
    category: "cicd",
    title: "GitHub Actions workflow",
    message: "CI/CD workflow file may affect builds, tests, or deployments.",
  },
  {
    test: (p) => /(^|\/)Dockerfile(\.|$)/i.test(p) || /docker-compose/i.test(p),
    ruleId: "dockerfile_changed",
    presentRuleId: "docker_present",
    category: "infrastructure",
    title: "Docker image / compose",
    message: "Container build or compose configuration may be affected.",
  },
  {
    test: (p) =>
      /(^|\/)(?:k8s|kubernetes|manifests)\//i.test(p) ||
      (/deployment|service|ingress/i.test(p) && /\.ya?ml$/i.test(p)),
    ruleId: "kubernetes_changed",
    presentRuleId: "kubernetes_present",
    category: "infrastructure",
    title: "Kubernetes manifest",
    message: "Kubernetes deployment surface may be affected.",
  },
  {
    test: (p) => /(^|\/)charts?\//i.test(p) || /Chart\.ya?ml$/i.test(p),
    ruleId: "helm_changed",
    presentRuleId: "helm_changed",
    category: "infrastructure",
    title: "Helm chart",
    message: "Helm packaging / values may be affected.",
  },
  {
    test: (p) => /\.tf$/i.test(p) || /(^|\/)terraform\//i.test(p),
    ruleId: "terraform_changed",
    presentRuleId: "terraform_present",
    category: "infrastructure",
    title: "Terraform",
    message: "Infrastructure-as-code may change cloud resources.",
  },
  {
    test: (p) => /argocd/i.test(p) || /(^|\/)argocd\//i.test(p),
    ruleId: "argocd_changed",
    presentRuleId: "argocd_changed",
    category: "infrastructure",
    title: "Argo CD",
    message: "GitOps deployment application may be affected.",
  },
];

export function runCicdChecks(input: {
  allRelativeFiles: string[];
  infraSignals: InfraSignal[];
  changes?: ChangeRecord[];
}): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const changed = new Set((input.changes ?? []).map((c) => c.filePath.replace(/\\/g, "/")));

  // Presence inventory (info) — useful for infra repos / empty API pages
  const seenPresent = new Set<string>();
  for (const file of input.allRelativeFiles) {
    const p = file.replace(/\\/g, "/");
    for (const rule of PATH_RULES) {
      if (!rule.test(p)) continue;
      const presentId = rule.presentRuleId ?? rule.ruleId;
      const key = `${presentId}:${rule.title}`;
      if (seenPresent.has(key)) continue;
      seenPresent.add(key);
      findings.push(
        finding({
          ruleId: presentId,
          category: rule.category,
          severity: "info",
          title: `${rule.title} detected`,
          message: `${rule.title} configuration found at ${p}.`,
          file: p,
          confidence: "HIGH",
        }),
      );
    }
  }

  // Also from infra signals
  for (const signal of input.infraSignals) {
    const map: Record<string, CheckFinding["ruleId"]> = {
      docker: "docker_present",
      terraform: "terraform_present",
      kubernetes: "kubernetes_present",
      helm: "helm_changed",
      argocd: "argocd_changed",
      github_actions: "github_actions_present",
    };
    const ruleId = map[signal.kind];
    if (!ruleId) continue;
    findings.push(
      finding({
        ruleId,
        category: signal.kind === "github_actions" ? "cicd" : "infrastructure",
        severity: "info",
        title: `${signal.label} detected`,
        message: `Repository includes ${signal.label} at ${signal.path}.`,
        file: signal.path,
      }),
    );
  }

  // PR / change impact on CI+infra
  if (changed.size > 0) {
    for (const file of changed) {
      for (const rule of PATH_RULES) {
        if (!rule.test(file)) continue;
        findings.push(
          finding({
            ruleId: rule.ruleId,
            category: rule.category,
            severity: "medium",
            title: `${rule.title} affected by this change`,
            message: rule.message,
            file,
            confidence: "HIGH",
          }),
        );
      }
    }
  }

  return dedupe(findings);
}

function dedupe(findings: CheckFinding[]): CheckFinding[] {
  const seen = new Set<string>();
  const out: CheckFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}
