import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/rule-engine.ts", "src/analyzers/manifest.ts"],
      thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
    },
  },
});
