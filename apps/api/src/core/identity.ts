import fp from "fastify-plugin";
import { UserId } from "@globetrotter/contracts";
import { UnauthenticatedError } from "./errors.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";

/**
 * TEMPORARY identity seam for the skeleton (issue #13).
 *
 * Issue #15 replaces the body of `requireUserId` with real access-token
 * verification. Everything else in the codebase already depends only on this
 * signature, so that change touches exactly one file.
 *
 * Until then the caller is read from an `x-user-id` header. That is obviously
 * not authentication, so it is FAIL-CLOSED: in production this always throws,
 * which makes it impossible to ship the bypass by accident.
 */

declare module "fastify" {
  interface FastifyInstance {
    requireUserId: (request: FastifyRequest) => UserId;
  }
}

async function identityPlugin(app: FastifyInstance, config: Config): Promise<void> {
  const devIdentityAllowed = config.NODE_ENV !== "production";

  app.decorate("requireUserId", (request: FastifyRequest): UserId => {
    if (!devIdentityAllowed) {
      throw new UnauthenticatedError(
        "Authentication is not yet implemented — see issue #15",
      );
    }

    const header = request.headers["x-user-id"];
    const raw = Array.isArray(header) ? header[0] : header;

    const parsed = UserId.safeParse(raw);
    if (!parsed.success) {
      throw new UnauthenticatedError("Missing or malformed x-user-id header");
    }

    return parsed.data;
  });

  if (devIdentityAllowed) {
    app.log.warn("dev identity header (x-user-id) is ENABLED — never run this in production");
  }
}

export default fp(identityPlugin, { name: "identity" });
