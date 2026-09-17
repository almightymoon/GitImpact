import type { CheckFinding, CheckRuleId } from "@gitimpact/shared";

/** Default “why it matters” + remediation per rule — keeps scanners concise. */
export const RULE_GUIDANCE: Record<
  CheckRuleId,
  { whyItMatters: string; remediation: string }
> = {
  secret_exposure: {
    whyItMatters:
      "Committed secrets can be scraped from git history and used for account takeover or cloud abuse.",
    remediation:
      "Rotate the credential immediately, remove it from history if needed, and load secrets from a vault or environment at runtime.",
  },
  insecure_auth_pattern: {
    whyItMatters:
      "Weak auth patterns often lead to session fixation, credential stuffing success, or broken access control.",
    remediation:
      "Prefer established auth libraries, enforce HTTPS-only cookies, and avoid rolling crypto or plaintext token compares.",
  },
  unsafe_env_handling: {
    whyItMatters:
      "Literal defaults for secrets mask misconfiguration in production and keep weak credentials in source control.",
    remediation:
      "Fail closed when required env vars are missing; never ship secret-like string defaults.",
  },
  dangerous_dependency: {
    whyItMatters:
      "Deprecated or high-risk packages accumulate known CVEs and are rarely maintained for security patches.",
    remediation:
      "Replace with a maintained alternative, pin versions, and verify there is no transitive exposure in lockfiles.",
  },
  suspicious_input_handling: {
    whyItMatters:
      "Unvalidated input reaching sinks (eval, shell, HTML) is a common path to RCE or XSS.",
    remediation:
      "Validate and encode at trust boundaries; avoid dynamic code execution on user-controlled data.",
  },
  auth_sensitive_change: {
    whyItMatters:
      "Auth-related diffs can silently widen who can access protected resources.",
    remediation:
      "Review authorization checks on the changed paths and add regression tests for denied access cases.",
  },
  high_complexity_function: {
    whyItMatters:
      "High cyclomatic complexity correlates with hard-to-review bugs and missed edge cases in PRs.",
    remediation:
      "Split into smaller functions, extract branches, or suppress via `.gitimpact.yml` if this is known legacy.",
  },
  large_function: {
    whyItMatters:
      "Very large functions hide side effects and make blast-radius reasoning unreliable.",
    remediation:
      "Extract cohesive helpers and keep the public entrypoint focused on orchestration.",
  },
  large_class: {
    whyItMatters:
      "God classes accumulate unrelated responsibilities and become change hotspots.",
    remediation:
      "Split by responsibility (I/O, domain, presentation) and keep a thin façade if needed.",
  },
  unused_export: {
    whyItMatters:
      "Dead exports inflate public surface area and confuse impact analysis.",
    remediation:
      "Remove unused exports or mark them as internal; confirm no dynamic imports rely on them.",
  },
  circular_dependency: {
    whyItMatters:
      "Import cycles cause fragile init order, harder testing, and incomplete impact graphs.",
    remediation:
      "Break the cycle with a shared types module, dependency inversion, or lazy imports.",
  },
  unsafe_any: {
    whyItMatters:
      "`any` disables type checking where regressions would otherwise be caught at compile time.",
    remediation:
      "Replace with a concrete type or `unknown` plus narrowing; avoid casting through `any`.",
  },
  weak_error_handling: {
    whyItMatters:
      "Empty or swallowed catches hide failures until they surface as data corruption or outages.",
    remediation:
      "Log with context, rethrow unexpected errors, and only catch errors you can meaningfully handle.",
  },
  duplicate_function_name: {
    whyItMatters:
      "Duplicate symbol names make call-graph and blast-radius mapping ambiguous.",
    remediation:
      "Rename for uniqueness within the module boundary or consolidate shared helpers.",
  },
  outdated_risk_signal: {
    whyItMatters:
      "Very old major versions often miss security patches and break with modern runtimes.",
    remediation:
      "Plan an upgrade path; check changelogs and run the test suite after bumping.",
  },
  deprecated_package_pattern: {
    whyItMatters:
      "Deprecated packages signal abandoned maintenance and rising security debt.",
    remediation:
      "Migrate to the recommended replacement and remove the deprecated dependency.",
  },
  github_actions_changed: {
    whyItMatters:
      "CI workflow edits can weaken supply-chain controls or skip required gates.",
    remediation:
      "Review permissions, secrets usage, and whether required checks still run on this branch.",
  },
  dockerfile_changed: {
    whyItMatters:
      "Image/build changes affect runtime attack surface and deployment reproducibility.",
    remediation:
      "Confirm base images, exposed ports, and non-root users; rebuild and smoke-test the image.",
  },
  kubernetes_changed: {
    whyItMatters:
      "Kubernetes manifest changes can alter networking, privileges, or resource limits in prod.",
    remediation:
      "Diff RBAC, probes, and resource requests; apply to a staging cluster before production.",
  },
  helm_changed: {
    whyItMatters:
      "Chart or values edits can roll out unintended config across many environments.",
    remediation:
      "Run `helm template` / dry-run and compare rendered manifests before merging.",
  },
  terraform_changed: {
    whyItMatters:
      "IaC changes can destroy or expose cloud resources if plans are not reviewed.",
    remediation:
      "Require a reviewed `terraform plan` and lock down state backend credentials.",
  },
  argocd_changed: {
    whyItMatters:
      "GitOps app definitions control what production continuously reconciles.",
    remediation:
      "Verify destination clusters, sync policies, and that secrets are not committed as plain text.",
  },
  docker_present: {
    whyItMatters:
      "Containerized deploys need image hygiene and least-privilege runtime defaults.",
    remediation:
      "Keep Dockerfiles minimal, pin digests when practical, and scan images in CI.",
  },
  kubernetes_present: {
    whyItMatters:
      "Cluster workloads need network policy, RBAC, and resource limits to stay safe at scale.",
    remediation:
      "Document the deploy path and ensure manifests are covered by review + staging apply.",
  },
  terraform_present: {
    whyItMatters:
      "Infrastructure-as-code is high blast radius; drift and secrets in state are common risks.",
    remediation:
      "Use remote state with locking, and never commit `.tfvars` with live credentials.",
  },
  github_actions_present: {
    whyItMatters:
      "Workflows often hold privileged tokens; misconfiguration is a supply-chain vector.",
    remediation:
      "Pin actions by SHA when possible and keep `permissions:` least privilege.",
  },
};

export function enrichFindingGuidance(finding: CheckFinding): CheckFinding {
  const guide = RULE_GUIDANCE[finding.ruleId];
  if (!guide) return finding;
  return {
    ...finding,
    whyItMatters: finding.whyItMatters ?? guide.whyItMatters,
    remediation: finding.remediation ?? guide.remediation,
  };
}
