import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["accuracy.test.ts"],
    exclude: ["cases/**", "node_modules/**"],
    testTimeout: 60_000,
  },
});
