import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests resolve @globetrotter/contracts from SOURCE, not from dist.
 *
 * The package's `main` points at dist/, so without this a stale build silently
 * changes behaviour: a schema added to the barrel but not yet compiled comes
 * back `undefined`, and Fastify fails at response-serialisation time with
 * "Cannot read properties of undefined (reading '_parse')" — which names
 * neither the schema nor the staleness. Cost a real debugging cycle.
 *
 * Pointing at source makes the tests exercise what is actually written, and
 * removes an entire class of "works alone, fails in CI" failures. The build is
 * still type-checked and still what ships.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@globetrotter/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
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
