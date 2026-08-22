import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share one Postgres database, so they must not race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.service.ts", "src/**/*.repository.ts"],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 60 },
    },
  },
});
