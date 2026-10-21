import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
    globalSetup: ["tests/corpus/vitest-setup.ts"],
    testTimeout: 60_000,
  },
});
