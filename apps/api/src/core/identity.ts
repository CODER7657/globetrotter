import fp from "fastify-plugin";
import { sql } from "kysely";
import { createTokens } from "./tokens.js";
import { UnauthenticatedError, ForbiddenError } from "./errors.js";
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { UserId } from "@globetrotter/contracts";
import type { Config } from "../config.js";
import type { AccessTokenClaims, Tokens } from "./tokens.js";

/**
 * Authentication (issue #15).
 *
 * `authenticate` is a preHandler that verifies the bearer access token and
 * attaches the claims to the request. `requireUserId` then reads what that
 * hook proved — it never authenticates anything itself, so forgetting the
 * preHandler fails closed with a 401 rather than silently trusting input.
 */

declare module "fastify" {
  interface FastifyInstance {
    tokens: Tokens;
    authenticate: preHandlerAsyncHookHandler;
    requireAdmin: preHandlerAsyncHookHandler;
    requireUserId: (request: FastifyRequest) => UserId;
  }

  interface FastifyRequest {
    authUser?: AccessTokenClaims;
  }
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;

  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || value === undefined || value.length === 0) {
    return undefined;
  }

  return value;
}

async function identityPlugin(app: FastifyInstance, config: Config): Promise<void> {
  const tokens = createTokens(config);
  app.decorate("tokens", tokens);

  const authenticate: preHandlerAsyncHookHandler = async (request) => {
    const token = bearerToken(request);
    if (token === undefined) {
      throw new UnauthenticatedError("Missing bearer access token");
    }

    request.authUser = await tokens.verify(token);
  };

  app.decorate("authenticate", authenticate);

  /**
   * Admin gate, resolved against the DATABASE rather than the token.
   *
   * The access token carries a role, but it is a snapshot from login and
   * lives for ten minutes. Trusting it means a demoted admin keeps admin
   * access until their token expires, and a freshly promoted one is refused
   * until they sign in again. Neither is acceptable for the one role that
   * can read every account.
   *
   * `app.is_admin()` is the same predicate every RLS policy consults, so the
   * gate and the row-level rules can never disagree. One cheap query buys
   * that; a test demotes an admin and asserts their existing token stops
   * working.
   */
  app.decorate("requireAdmin", async function requireAdmin(request, reply) {
    await authenticate.call(this, request, reply);

    const claims = request.authUser;
    if (claims === undefined) {
      throw new UnauthenticatedError("Authentication required");
    }

    const isAdmin = await app.withTx(claims.userId, async (trx) => {
      const result = await sql<{ ok: boolean }>`select app.is_admin() as ok`.execute(trx);
      return result.rows[0]?.ok ?? false;
    });

    if (!isAdmin) {
      throw new ForbiddenError("This endpoint requires an admin account");
    }
  } as preHandlerAsyncHookHandler);

  app.decorate("requireUserId", (request: FastifyRequest): UserId => {
    const claims = request.authUser;
    if (claims === undefined) {
      // Reached only if a route forgot `preHandler: app.authenticate`.
      throw new UnauthenticatedError("Authentication required");
    }

    return claims.userId;
  });
}

export default fp(identityPlugin, { name: "identity" });
