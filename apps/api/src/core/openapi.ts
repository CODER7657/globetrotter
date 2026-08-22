import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import { API_PREFIX } from "./constants.js";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";

/**
 * OpenAPI 3.1, generated from the route schemas (#66 item 5).
 *
 * Nothing here re-describes an endpoint. Every path, parameter and response
 * body is derived from the Zod schemas the routes already validate against,
 * so the document cannot drift from the API — a hand-written spec is a second
 * source of truth that silently goes stale, which is the whole problem
 * packages/contracts exists to prevent.
 *
 * Consequence worth knowing: a route with no `schema` is invisible here. That
 * is a feature — it makes an undocumented endpoint an obvious omission rather
 * than a quiet one.
 */

const DESCRIPTION = `
Postgres-native multi-city travel planner.

**Authentication.** \`POST /auth/login\` returns a short-lived access token;
send it as \`Authorization: Bearer <token>\`. The refresh token is set as an
httpOnly cookie and is never readable from JavaScript — call
\`POST /auth/refresh\` to rotate it.

**Errors** are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
\`application/problem+json\`. Every response carries a \`traceId\` that matches
the server log line, and a \`code\` from a fixed enum. Violations of the
schema's temporal guarantees additionally carry \`constraint\`, naming the rule
that rejected the write.

**Money** is a decimal string everywhere except the cost breakdown, where it
is a JSON number — see that endpoint's notes.
`.trim();

export async function registerOpenApi(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "GlobeTrotter API",
        description: DESCRIPTION,
        version: "1.0.0",
      },
      servers: [{ url: config.APP_BASE_URL, description: "This deployment" }],
      tags: [
        { name: "auth", description: "Registration, login, and refresh-token rotation" },
        { name: "trips", description: "Trips and their cost breakdown" },
        { name: "stops", description: "Ordered cities within a trip" },
        { name: "activities", description: "Activities scheduled inside a stop" },
        { name: "sharing", description: "Public links and copying" },
        { name: "search", description: "Hybrid search and the city/activity catalogue" },
        { name: "ops", description: "Liveness and readiness probes" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Access token from /auth/login or /auth/signup.",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(scalar, {
    routePrefix: "/docs",
    configuration: {
      title: "GlobeTrotter API",
      // Scalar fetches the generated document rather than embedding a copy,
      // so the page can never show a stale spec.
      url: `${API_PREFIX}/openapi.json`,
    },
  });

  app.get(
    `${API_PREFIX}/openapi.json`,
    {
      schema: {
        tags: ["ops"],
        summary: "The generated OpenAPI 3.1 document",
        hide: true,
      },
    },
    async () => app.swagger(),
  );
}
