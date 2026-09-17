import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["real-world.test.ts"],
    exclude: ["cases/**", "node_modules/**"],
    testTimeout: 90_000,
  },
});
