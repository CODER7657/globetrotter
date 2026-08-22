import { z } from "zod";
import { sql } from "kysely";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * Liveness and readiness are genuinely different questions (issue #22):
 *
 *   /health  "is this process alive?"      — never touches the DB, so a slow
 *                                            database cannot get the container
 *                                            killed and restarted in a loop.
 *   /ready   "should traffic be routed?"   — checks the DB, so a pod with a
 *                                            broken pool is pulled from the
 *                                            load balancer without dying.
 */
const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["ops"],
        summary: "Liveness probe",
        response: { 200: z.object({ status: z.literal("ok"), uptime: z.number() }) },
      },
    },
    async () => ({ status: "ok" as const, uptime: process.uptime() }),
  );

  app.get(
    "/ready",
    {
      schema: {
        tags: ["ops"],
        summary: "Readiness probe — verifies the database is reachable",
        response: {
          200: z.object({ status: z.literal("ready"), database: z.literal("up") }),
          503: z.object({ status: z.literal("degraded"), database: z.literal("down") }),
        },
      },
    },
    async (request, reply) => {
      try {
        await sql`select 1`.execute(app.db);
        return { status: "ready" as const, database: "up" as const };
      } catch (error) {
        request.log.error({ err: error }, "readiness check failed");
        return reply.status(503).send({ status: "degraded" as const, database: "down" as const });
      }
    },
  );
};

export default healthRoutes;
