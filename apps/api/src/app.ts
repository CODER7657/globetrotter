import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import databasePlugin from "./db/plugin.js";
import identityPlugin from "./core/identity.js";
import { registerErrorHandler } from "./core/error-handler.js";
import { registerOpenApi } from "./core/openapi.js";
import { API_PREFIX } from "./core/constants.js";
import authRoutes from "./modules/auth/auth.routes.js";
import healthRoutes from "./modules/health/health.routes.js";
import activitiesRoutes from "./modules/trips/activities.routes.js";
import collaboratorsRoutes from "./modules/trips/collaborators.routes.js";
import sharingRoutes from "./modules/sharing/sharing.routes.js";
import costRoutes from "./modules/trips/cost.routes.js";
import searchRoutes from "./modules/catalogue/search.routes.js";
import stopsRoutes from "./modules/trips/stops.routes.js";
import tripsRoutes from "./modules/trips/trips.routes.js";
import realtimeRoutes from "./modules/realtime/realtime.routes.js";
import { isProduction } from "./config.js";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config.js";

// Re-exported so existing imports from app.ts keep working; the constant
// itself lives in core/ to avoid a cycle with the OpenAPI registration.
export { API_PREFIX } from "./core/constants.js";

/**
 * Composition root. Everything is wired here and nowhere else — no module
 * reaches for a global, which is what makes `buildApp` usable directly from a
 * test via fastify.inject() with no server listening (issue #23).
 */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    // traceId. Every log line and every problem+json response carries it, so
    // a user-reported error maps to exact log lines (issue #16).
    genReqId: () => randomUUID(),
    // Never trust a client-supplied request id — it would let a caller forge
    // or collide with another request's trace.
    requestIdHeader: false,
    // Bind the id as `traceId` on every child logger, matching the field name
    // used in problem+json responses so the two can be grepped together.
    childLoggerFactory: function (logger, bindings, opts) {
      const { reqId } = bindings as { reqId?: unknown };
      return logger.child({ ...bindings, traceId: reqId }, opts);
    },
    bodyLimit: 1_048_576, // 1 MiB (issue #18)
    trustProxy: isProduction(config),
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-user-id']",
          "res.headers['set-cookie']",
          "*.password",
          "*.passwordHash",
          "*.token",
          "*.accessToken",
          "*.refreshToken",
        ],
        censor: "[redacted]",
      },
      ...(isProduction(config) ? {} : { transport: { target: "pino-pretty" } }),
    },
  });

  // Zod drives both request validation and response serialisation, straight
  // from packages/contracts. OpenAPI generation (issue #23) hangs off these.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app, config);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  await app.register(cors, {
    // Allowlist from env, credentials on, never a wildcard (issue #18).
    origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  // Registered before any route: @fastify/swagger captures schemas as routes
  // are added, so anything registered earlier would be missing from the
  // document.
  await registerOpenApi(app, config);

  await app.register(databasePlugin, config);
  await app.register(identityPlugin, config);

  // One encapsulated plugin per module (issue #13).
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: API_PREFIX, config });
  await app.register(tripsRoutes, { prefix: API_PREFIX });
  await app.register(stopsRoutes, { prefix: API_PREFIX });
  await app.register(activitiesRoutes, { prefix: API_PREFIX });
  await app.register(collaboratorsRoutes, { prefix: API_PREFIX });
  await app.register(costRoutes, { prefix: API_PREFIX });
  await app.register(searchRoutes, { prefix: API_PREFIX });
  await app.register(realtimeRoutes, { prefix: API_PREFIX, config });
  await app.register(sharingRoutes, { prefix: API_PREFIX, config });

  return app;
}
