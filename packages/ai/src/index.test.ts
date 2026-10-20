import { describe, expect, it } from "vitest";
import {
  assertSafeAiBaseUrl,
  buildImpactNarrativePrompt,
  enrichImpactNarrative,
  loadAiConfig,
  sanitizeImpactDigest,
} from "./index.js";

describe("@gitimpact/ai", () => {
  it("loads disabled config without keys", () => {
    const cfg = loadAiConfig({});
    expect(cfg.enabled).toBe(false);
  });

  it("enables when key + flag present", () => {
    const cfg = loadAiConfig({
      GITIMPACT_AI_ENABLED: "1",
      GITIMPACT_AI_API_KEY: "sk-test",
      GITIMPACT_AI_PROVIDER: "openai",
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe("openai");
  });

  it("builds a structured digest prompt", () => {
    const prompt = buildImpactNarrativePrompt({
      repository: "acme/api",
      pullRequestNumber: 12,
      complexityScore: 40,
      impactLevel: "MEDIUM",
      changedSymbols: ["login"],
      affectedApis: ["POST /login"],
      relevantTests: ["login.test.ts"],
      summary: "Touches auth",
      frameworks: ["Express"],
      directDependents: 3,
      indirectDependents: 8,
      whyTarget: "AdminPanel",
    });
    expect(prompt).toContain("### What changed");
    expect(prompt).toContain("login");
    expect(prompt).toContain("POST /login");
    expect(prompt).toContain("Express");
    expect(prompt).toContain("AdminPanel");
    expect(prompt).not.toContain("sk-");
  });

  it("redacts secret-like digest strings", () => {
    const result = sanitizeImpactDigest({
      repository: "acme/api",
      changedSymbols: ["login", "sk-abcdefghijklmnopqrstuvwxyz12"],
      affectedApis: ["Authorization: Bearer ghp_abcdefghijklmnopqrstuv"],
      relevantTests: [],
      summary: "api_key=supersecretvalue1234567890",
    });
    expect(result.ok).toBe(true);
    expect(result.digest!.changedSymbols).toContain("[redacted]");
    expect(result.digest!.affectedApis).toContain("[redacted]");
    expect(result.digest!.summary).toBe("[redacted]");
  });

  it("rejects invalid repository ids", () => {
    const result = sanitizeImpactDigest({
      repository: "../etc/passwd",
      changedSymbols: [],
      affectedApis: [],
      relevantTests: [],
    });
    expect(result.ok).toBe(false);
  });

  it("does not use server keys when allowServerKey is false", async () => {
    const narrative = await enrichImpactNarrative(
      {
        repository: "acme/api",
        changedSymbols: ["a"],
        affectedApis: [],
        relevantTests: [],
      },
      {
        allowServerKey: false,
        env: {
          GITIMPACT_AI_ENABLED: "1",
          GITIMPACT_AI_API_KEY: "sk-server-should-not-be-used",
        },
      },
    );
    expect(narrative).toBeUndefined();
  });

  it("rejects non-https custom base URLs", () => {
    expect(() =>
      assertSafeAiBaseUrl("http://evil.example/v1", "openai-compatible"),
    ).toThrow(/https/);
  });

  it("allows default OpenAI host", () => {
    expect(assertSafeAiBaseUrl(undefined, "openai")).toContain("api.openai.com");
  });
});
