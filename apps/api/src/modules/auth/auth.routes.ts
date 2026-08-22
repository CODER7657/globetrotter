import { z } from "zod";
import { UnauthenticatedError } from "../../core/errors.js";
import { createAuthService } from "./auth.service.js";
import {
  AuthSessionSchema,
  LoginBodySchema,
  PublicUserSchema,
  SignupBodySchema,
  envelope,
} from "./auth.schema.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../../config.js";
import type { IssuedSession } from "./auth.service.js";

/**
 * Auth HTTP layer (issue #15).
 *
 * The refresh token travels only as an httpOnly cookie — it is never in a
 * response body, so no amount of XSS can read it out of JavaScript.
 */

const REFRESH_COOKIE = "gt_refresh";

/** Scoped to the auth routes: the cookie is not attached to ordinary API calls. */
const COOKIE_PATH = "/api/v1/auth";

const authRoutes: FastifyPluginAsyncZod<{ config: Config }> = async (app, opts) => {
  const { config } = opts;
  const service = createAuthService(app.withTx, app.tokens);

  const cookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    // Lax, not Strict: Strict would drop the cookie when the user arrives via
    // an email verification link, silently logging them out mid-flow.
    sameSite: "lax" as const,
    path: COOKIE_PATH,
    maxAge: config.REFRESH_TOKEN_TTL_SECONDS,
  };

  const sendSession = (reply: FastifyReply, issued: IssuedSession, status: number) =>
    reply
      .status(status)
      .setCookie(REFRESH_COOKIE, issued.refreshToken, cookieOptions)
      .send({ data: issued.session });

  const userAgentOf = (request: FastifyRequest): string | null =>
    request.headers["user-agent"]?.slice(0, 500) ?? null;

  // Auth endpoints get a far tighter budget than the global one: this is where
  // credential stuffing lands (issue #18).
  const authRateLimit = {
    rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: "1 minute" },
  };

  app.post(
    "/auth/signup",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Create an account and start a session",
        body: SignupBodySchema,
        response: { 201: envelope(AuthSessionSchema) },
      },
    },
    async (request, reply) => {
      const issued = await service.signup(request.body, userAgentOf(request));
      return sendSession(reply, issued, 201);
    },
  );

  app.post(
    "/auth/login",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Exchange credentials for a session",
        body: LoginBodySchema,
        response: { 200: envelope(AuthSessionSchema) },
      },
    },
    async (request, reply) => {
      const issued = await service.login(request.body, userAgentOf(request));
      return sendSession(reply, issued, 200);
    },
  );

  app.post(
    "/auth/refresh",
    {
      config: authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Rotate the refresh token and mint a new access token",
        response: { 200: envelope(AuthSessionSchema) },
      },
    },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (token === undefined) {
        // Same shape as a rejected token: whether a cookie was sent at all is
        // not information worth confirming.
        throw new UnauthenticatedError("Invalid refresh token");
      }

      const issued = await service.refresh(token);
      return sendSession(reply, issued, 200);
    },
  );

  app.post(
    "/auth/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Revoke the current session",
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (token !== undefined) {
        await service.logout(token);
      }

      // Clear the cookie regardless, so a client holding a token we do not
      // recognise still ends up logged out.
      return reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH }).status(204).send(null);
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["auth"],
        summary: "The currently authenticated user",
        response: { 200: envelope(PublicUserSchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return { data: await service.currentUser(userId) };
    },
  );
};

export default authRoutes;
