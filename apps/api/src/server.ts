import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { FastifyInstance } from "fastify";

/**
 * Process entrypoint: boot, then shut down cleanly (issue #13, #16).
 *
 * Kept separate from app.ts so tests can build an app without ever binding a
 * port or installing process-wide signal handlers.
 */

const SHUTDOWN_TIMEOUT_MS = 10_000;

function installShutdownHandlers(app: FastifyInstance): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, "shutting down");

    // If in-flight requests refuse to drain, exit anyway rather than hang the
    // orchestrator until it sends SIGKILL.
    const timer = setTimeout(() => {
      app.log.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    app
      .close()
      .then(() => {
        app.log.info("shutdown complete");
        process.exit(0);
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, "error during shutdown");
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // An unhandled rejection or uncaught exception means the process is in an
  // unknown state. Log it, then leave — never keep serving (issue #16).
  process.on("unhandledRejection", (reason) => {
    app.log.fatal({ err: reason }, "unhandled promise rejection");
    shutdown("unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    app.log.fatal({ err: error }, "uncaught exception");
    shutdown("uncaughtException");
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  installShutdownHandlers(app);

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((error: unknown) => {
  // The logger may not exist yet if config parsing threw.
  console.error("failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
