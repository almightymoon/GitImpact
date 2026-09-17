import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["accuracy.test.ts", "pr-comment.test.ts", "webhook-signature.test.ts"],
    exclude: ["cases/**", "node_modules/**"],
    testTimeout: 60_000,
  },
});
