import { describe, expect, it } from "vitest";
import {
  buildImpactNarrativePrompt,
  loadAiConfig,
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

  it("builds a digest prompt without inventing symbols", () => {
    const prompt = buildImpactNarrativePrompt({
      repository: "acme/api",
      pullRequestNumber: 12,
      complexityScore: 40,
      impactLevel: "MEDIUM",
      changedSymbols: ["login"],
      affectedApis: ["POST /login"],
      relevantTests: ["login.test.ts"],
      summary: "Touches auth",
    });
    expect(prompt).toContain("login");
    expect(prompt).toContain("POST /login");
    expect(prompt).not.toContain("sk-");
  });
});
