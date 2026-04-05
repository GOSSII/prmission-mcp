import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Only run validation tests by default (smoke tests require a running server)
    exclude: ["tests/smoke.test.ts"],
    globals: false,
  },
});
