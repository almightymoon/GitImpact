import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "accuracy.test.ts",
      "pr-comment.test.ts",
      "webhook-signature.test.ts",
      "pr-workflow.test.ts",
      "ux-presentation.test.ts",
      "checks.test.ts",
    ],
    exclude: ["cases/**", "node_modules/**"],
    testTimeout: 60_000,
  },
});
