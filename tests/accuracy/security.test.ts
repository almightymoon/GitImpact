import { describe, expect, it } from "vitest";
import { log, resetMetricsForTests, getMetricsSnapshot, incMetric } from "@gitimpact/ops";
import { parseGitHubUrl, redactGitCredentials } from "@gitimpact/git";

describe("security hardening", () => {
  it("redacts installation tokens from clone URLs", () => {
    const raw =
      "Failed https://x-access-token:ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456@github.com/acme/app.git";
    const cleaned = redactGitCredentials(raw);
    expect(cleaned).not.toContain("ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
    expect(cleaned).toMatch(/\[redacted\]/);
  });

  it("rejects unsafe protocols and hosts", () => {
    expect(() => parseGitHubUrl("file:///tmp/evil")).toThrow();
    expect(() => parseGitHubUrl("git://github.com/acme/app")).toThrow();
    expect(() => parseGitHubUrl("ssh://git@github.com/acme/app")).toThrow();
    expect(() => parseGitHubUrl("https://gitlab.com/acme/app")).toThrow();
    expect(() => parseGitHubUrl("https://github.com.evil.example/acme/app")).toThrow();
  });

  it("rejects traversal-like repository names", () => {
    expect(() => parseGitHubUrl("github.com/acme/../passwd")).toThrow();
    expect(() => parseGitHubUrl("github.com/acme/foo..bar")).toThrow();
  });

  it("does not emit secrets through structured logging", () => {
    resetMetricsForTests();
    const lines: string[] = [];
    const original = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg));
    };
    try {
      log("info", "clone_attempt", {
        repository: "acme/app",
        detail:
          "https://x-access-token:ghs_SUPERSECRETTOKENVALUE99@github.com/acme/app.git Authorization: Bearer ghs_SUPERSECRETTOKENVALUE99",
        token: "ghs_SUPERSECRETTOKENVALUE99",
        authorization: "Bearer ghs_SUPERSECRETTOKENVALUE99",
      });
    } finally {
      console.log = original;
    }
    const joined = lines.join("\n");
    expect(joined).not.toContain("ghs_SUPERSECRETTOKENVALUE99");
    expect(joined).toContain("[redacted]");
  });

  it("records metrics without coupling to a vendor", () => {
    resetMetricsForTests();
    incMetric("analyses_started_total", 1, { kind: "security_test" });
    const snap = getMetricsSnapshot();
    expect(Object.keys(snap.counters).some((k) => k.includes("analyses_started_total"))).toBe(
      true,
    );
  });
});
