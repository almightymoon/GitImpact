import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubWebhookSignature } from "@gitimpact/git";

describe("verifyGitHubWebhookSignature", () => {
  it("accepts a valid HMAC signature", () => {
    const secret = "test-secret";
    const body = '{"action":"opened"}';
    const signature =
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyGitHubWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a bad signature", () => {
    expect(
      verifyGitHubWebhookSignature("{}", "sha256=deadbeef", "test-secret"),
    ).toBe(false);
  });
});
