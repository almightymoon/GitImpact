/** v0.9 — deterministic quality / security / CI findings */

export type CheckSeverity = "critical" | "high" | "medium" | "low" | "info";

export type CheckCategory =
  | "security"
  | "quality"
  | "dependencies"
  | "cicd"
  | "infrastructure";

export type CheckRuleId =
  // Security
  | "secret_exposure"
  | "insecure_auth_pattern"
  | "unsafe_env_handling"
  | "dangerous_dependency"
  | "suspicious_input_handling"
  | "auth_sensitive_change"
  // Quality
  | "high_complexity_function"
  | "large_function"
  | "large_class"
  | "unused_export"
  | "circular_dependency"
  | "unsafe_any"
  | "weak_error_handling"
  | "duplicate_function_name"
  // Dependencies
  | "outdated_risk_signal"
  | "deprecated_package_pattern"
  // CI / Infra
  | "github_actions_changed"
  | "dockerfile_changed"
  | "kubernetes_changed"
  | "helm_changed"
  | "terraform_changed"
  | "argocd_changed"
  | "docker_present"
  | "kubernetes_present"
  | "terraform_present"
  | "github_actions_present";

export interface CheckFinding {
  id: string;
  ruleId: CheckRuleId;
  category: CheckCategory;
  severity: CheckSeverity;
  title: string;
  message: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
  evidence?: string;
  /** Related graph node id when known */
  nodeId?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface CheckCategorySummary {
  category: CheckCategory;
  label: string;
  findingCount: number;
  bySeverity: Record<CheckSeverity, number>;
  highlights: string[];
}

export interface ChecksReport {
  findings: CheckFinding[];
  summaries: CheckCategorySummary[];
  totals: {
    findings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  /** Short bullets for PR overview / comments */
  prHighlights: {
    changeImpact?: string[];
    codeQuality: string[];
    security: string[];
    cicd: string[];
  };
  generatedAt: string;
}
