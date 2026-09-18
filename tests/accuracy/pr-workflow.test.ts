import { describe, expect, it, beforeEach } from "vitest";
import {
  claimWebhookDelivery,
  updateWebhookDelivery,
  upsertGitHubInstallation,
  findInstallationIdForOwner,
  __resetDeliveryMemoryForTests,
} from "@gitimpact/db";
import {
  formatPullRequestComment,
  GITIMPACT_COMMENT_MARKER,
} from "../../packages/analysis/src/pr-comment.ts";
import { formatCheckRunSummary } from "@gitimpact/git";
import type {
  ImpactReport,
  PullRequestImpactOverview,
  PullRequestMeta,
} from "@gitimpact/shared";

describe("webhook delivery idempotency", () => {
  beforeEach(() => {
    __resetDeliveryMemoryForTests();
  });

  it("claims a delivery once and marks duplicates", async () => {
    const first = await claimWebhookDelivery({
      deliveryId: "delivery-1",
      event: "pull_request",
      action: "opened",
      owner: "acme",
      repo: "app",
      prNumber: 7,
      installationId: 99,
    });
    expect(first.claimed).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await claimWebhookDelivery({
      deliveryId: "delivery-1",
      event: "pull_request",
      action: "opened",
      owner: "acme",
      repo: "app",
      prNumber: 7,
    });
    expect(second.duplicate).toBe(true);
    expect(second.claimed).toBe(false);

    await updateWebhookDelivery("delivery-1", { status: "completed" });
  });

  it("stores installation ids by account login", async () => {
    await upsertGitHubInstallation({
      installationId: 12345,
      accountLogin: "acme",
      accountType: "Organization",
    });
    expect(await findInstallationIdForOwner("acme")).toBe(12345);
    expect(await findInstallationIdForOwner("Acme")).toBe(12345);
  });
});

describe("comment upsert identity", () => {
  it("keeps a stable bot marker across updates", () => {
    const pullRequest: PullRequestMeta = {
      owner: "acme",
      repo: "app",
      number: 1,
      title: "test",
      baseBranch: "main",
      headBranch: "feat",
      url: "https://github.com/acme/app/pull/1",
    };
    const overview: PullRequestImpactOverview = {
      filesChanged: 1,
      functionsModified: 1,
      directDependencies: 1,
      indirectDependencies: 0,
      apiRoutesAffected: 0,
      databaseModelsAffected: 0,
      frontendComponentsAffected: 0,
      relevantTests: 0,
      potentialMissingTests: 0,
      complexityScore: 10,
      impactLevel: "Low",
      summary: "ok",
      changedFiles: [],
      changeBreakdown: {
        STRUCTURAL: 0,
        INTERFACE: 0,
        BEHAVIORAL: 1,
        CONFIGURATION: 0,
      },
    };
    const impact: ImpactReport = {
      changedNodes: [],
      directImpact: [],
      indirectImpact: [],
      affectedFiles: [],
      affectedApis: [],
      relatedTests: [],
      missingTests: [],
      maxDepth: 3,
      complexityScore: 10,
      complexityBreakdown: [],
      summary: "ok",
    };

    const first = formatPullRequestComment({ pullRequest, impact, overview });
    const second = formatPullRequestComment({
      pullRequest,
      impact,
      overview: { ...overview, complexityScore: 42 },
    });

    expect(first.startsWith(GITIMPACT_COMMENT_MARKER)).toBe(true);
    expect(second.startsWith(GITIMPACT_COMMENT_MARKER)).toBe(true);
    expect(second).toContain("42/100");
  });
});

describe("check run summary", () => {
  it("formats a neutral informational summary", () => {
    const { title, summary } = formatCheckRunSummary({
      complexityScore: 42,
      changedSymbols: 3,
      directDependents: 8,
      indirectDependents: 17,
      affectedApis: 2,
      relevantTests: 6,
      potentialGaps: 1,
    });
    expect(title).toBe("Change Complexity: 42/100");
    expect(summary).toContain("3 changed symbols");
    expect(summary).toContain("1 potential coverage gap");
    expect(summary).toContain("**Conclusion:** neutral");
    expect(summary).toContain("does not block merges");
  });
});
