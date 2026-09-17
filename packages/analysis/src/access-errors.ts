import type { AnalysisErrorPayload, AnalysisIssueCode } from "@gitimpact/shared";

export function classifyAnalysisError(error: unknown): AnalysisErrorPayload {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    /not found or private|authentication failed|could not read username|bad credentials|401|403/.test(
      lower,
    )
  ) {
    const isPrivateish =
      /private|authentication failed|could not read username|bad credentials|403/.test(lower);
    const code: AnalysisIssueCode = isPrivateish ? "PRIVATE_REPOSITORY" : "ACCESS_DENIED";
    return {
      code,
      message:
        code === "PRIVATE_REPOSITORY"
          ? "GitImpact cannot access this private repository."
          : "GitImpact was denied access to this repository.",
      detail:
        "Public repositories work without authentication. Private repositories require GitHub authorization (GitHub App installation or a token with repo access).",
      action: "connect_github",
    };
  }

  if (/repository not found|404/.test(lower)) {
    return {
      code: "NOT_FOUND",
      message: "Repository not found on GitHub.",
      detail: message,
      action: "none",
    };
  }

  if (/no supported|no typescript|no javascript|0 files/.test(lower)) {
    return {
      code: "NO_SUPPORTED_FILES",
      message: "No supported source files were found in this repository.",
      detail:
        "GitImpact currently analyzes TypeScript and JavaScript. Infrastructure-only repos may still show detected workflows and manifests on Overview.",
      action: "none",
    };
  }

  if (/empty/.test(lower)) {
    return {
      code: "EMPTY_REPOSITORY",
      message: "This repository appears to be empty.",
      detail: message,
      action: "none",
    };
  }

  return {
    code: "ANALYSIS_FAILED",
    message: "Analysis failed.",
    detail: message,
    action: "retry",
  };
}
