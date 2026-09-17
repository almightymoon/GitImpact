import { githubApiHeaders } from "./github-api.js";
import { resolveGitHubToken } from "./github-app.js";

export type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "skipped";

export interface CheckRun {
  id: number;
  html_url?: string;
  status: string;
  conclusion?: string | null;
}

/**
 * Create an in-progress Check Run (does not block merges when conclusion is neutral).
 */
export async function createCheckRun(options: {
  owner: string;
  repo: string;
  headSha: string;
  name?: string;
  token?: string;
}): Promise<CheckRun> {
  const token = options.token ?? (await resolveGitHubToken());
  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/check-runs`,
    {
      method: "POST",
      headers: {
        ...githubApiHeaders(token),
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        name: options.name ?? "GitImpact",
        head_sha: options.headSha,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create check run: ${response.status} ${text}`);
  }
  return (await response.json()) as CheckRun;
}

export async function completeCheckRun(options: {
  owner: string;
  repo: string;
  checkRunId: number;
  conclusion?: CheckConclusion;
  title: string;
  summary: string;
  text?: string;
  token?: string;
}): Promise<CheckRun> {
  const token = options.token ?? (await resolveGitHubToken());
  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/check-runs/${options.checkRunId}`,
    {
      method: "PATCH",
      headers: {
        ...githubApiHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "completed",
        conclusion: options.conclusion ?? "neutral",
        completed_at: new Date().toISOString(),
        output: {
          title: options.title,
          summary: options.summary,
          text: options.text,
        },
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to complete check run: ${response.status} ${text}`);
  }
  return (await response.json()) as CheckRun;
}

export function formatCheckRunSummary(input: {
  complexityScore: number;
  changedSymbols: number;
  directDependents: number;
  indirectDependents: number;
  affectedApis: number;
  relevantTests: number;
  potentialGaps: number;
}): { title: string; summary: string } {
  return {
    title: `Change Complexity: ${input.complexityScore}/100`,
    summary: [
      `**Change Complexity:** ${input.complexityScore}/100`,
      "",
      `${input.changedSymbols} changed symbols`,
      `${input.directDependents} direct dependents`,
      `${input.indirectDependents} indirect dependents`,
      `${input.affectedApis} affected API routes`,
      `${input.relevantTests} relevant tests`,
      `${input.potentialGaps} potential coverage gap${input.potentialGaps === 1 ? "" : "s"}`,
      "",
      "**Conclusion:** neutral",
      "",
      "_Informational only — does not block merges._",
    ].join("\n"),
  };
}
