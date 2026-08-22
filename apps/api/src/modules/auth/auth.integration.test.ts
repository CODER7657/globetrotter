import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  STRONG_PASSWORD,
  adminQuery,
  asUser,
  buildTestApp,
  closeHarness,
  familyState,
  refreshCookieFrom,
  registerUser,
  truncateAll,
  withRefresh,
} from "../../test/harness.js";
import type { FastifyInstance } from "fastify";

describe("auth", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeHarness();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  const signup = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/auth/signup", payload });

  const login = (email: string, password: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });

  const refresh = (cookie: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: withRefresh(cookie) });

  describe("signup", () => {
    it("creates an account and returns a session", async () => {
      const response = await signup({
        email: "ada@example.test",
        password: STRONG_PASSWORD,
        displayName: "Ada",
      });

      expect(response.statusCode).toBe(201);

      const body = response.json<{ data: { accessToken: string; user: Record<string, unknown> } }>();
      expect(body.data.accessToken).toEqual(expect.any(String));
      expect(body.data.user).toMatchObject({
        email: "ada@example.test",
        displayName: "Ada",
        role: "traveler",
        emailVerifiedAt: null,
      });
    });

    it("never returns the refresh token in the body, only as an httpOnly cookie", async () => {
      const response = await signup({
        email: "ada@example.test",
        password: STRONG_PASSWORD,
        displayName: "Ada",
      });

      const cookie = String(response.headers["set-cookie"]);
      expect(cookie).toContain("gt_refresh=");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");

      // The token must appear nowhere JavaScript could read it.
      const refreshValue = refreshCookieFrom(response.headers["set-cookie"]);
      expect(response.body).not.toContain(refreshValue);
    });

    it("never stores the password in plaintext", async () => {
      await signup({
        email: "ada@example.test",
        password: STRONG_PASSWORD,
        displayName: "Ada",
      });

      // app.db connects as globetrotter_app, which is subject to RLS — with no
      // identity on the transaction it correctly sees zero rows. Reading a
      // stored hash is a fixture concern, so it goes through the admin pool.
      const rows = await adminQuery<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE email = $1", ["ada@example.test"],
      );

      expect(rows[0]?.password_hash).not.toContain(STRONG_PASSWORD);
      // Argon2id encoded hashes are self-describing.
      expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    });

    it("rejects a guessable password with a bindable field error", async () => {
      const response = await signup({
        email: "ada@example.test",
        password: "Password123!",
        displayName: "Ada",
      });

      expect(response.statusCode).toBe(422);

      const problem = response.json<{ code: string; errors: { path: string }[] }>();
      expect(problem.code).toBe("VALIDATION_FAILED");
      expect(problem.errors.map((e) => e.path)).toContain("password");
    });

    it("rejects a duplicate email", async () => {
      const user = await registerUser(app);
      const response = await signup({
        email: user.email,
        password: STRONG_PASSWORD,
        displayName: "Impostor",
      });

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe("DUPLICATE");
    });

    it("treats email as case-insensitive", async () => {
      const user = await registerUser(app, { email: "ada@example.test" });
      const response = await login("ADA@EXAMPLE.TEST", user.password);

      expect(response.statusCode).toBe(200);
    });
  });

  describe("login", () => {
    it("returns a session for correct credentials", async () => {
      const user = await registerUser(app);
      const response = await login(user.email, user.password);

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { accessToken: string } }>().data.accessToken).toEqual(
        expect.any(String),
      );
    });

    it("gives an identical answer for an unknown user and a wrong password", async () => {
      const user = await registerUser(app);

      const wrongPassword = await login(user.email, "definitely-not-the-password");
      const unknownUser = await login("nobody@example.test", "definitely-not-the-password");

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownUser.statusCode).toBe(401);

      // Identical code AND identical message: neither confirms the account.
      const a = wrongPassword.json<{ code: string; detail: string }>();
      const b = unknownUser.json<{ code: string; detail: string }>();
      expect(a.code).toBe("INVALID_CREDENTIALS");
      expect(b.code).toBe(a.code);
      expect(b.detail).toBe(a.detail);
    });

    it("starts a separate token family per login", async () => {
      const user = await registerUser(app);
      await login(user.email, user.password);

      // One family from signup, one from the login.
      expect(await familyState(user.id)).toHaveLength(2);
    });
  });

  describe("refresh rotation", () => {
    it("rotates the token and issues a new one", async () => {
      const user = await registerUser(app);
      const response = await refresh(user.refreshCookie);

      expect(response.statusCode).toBe(200);

      const rotated = refreshCookieFrom(response.headers["set-cookie"]);
      expect(rotated).not.toBe(user.refreshCookie);
    });

    it("rejects the old token once it has been rotated", async () => {
      const user = await registerUser(app);
      await refresh(user.refreshCookie);

      const replay = await refresh(user.refreshCookie);
      expect(replay.statusCode).toBe(401);
      expect(replay.json<{ code: string }>().code).toBe("TOKEN_REPLAYED");
    });

    it("revokes the WHOLE family when a rotated token is replayed", async () => {
      const user = await registerUser(app);

      const first = await refresh(user.refreshCookie);
      const current = refreshCookieFrom(first.headers["set-cookie"]);

      // An attacker replays the stolen, already-rotated token.
      await refresh(user.refreshCookie);

      // The legitimate user's current token is now dead too — that is the
      // point. We cannot tell attacker from victim, so both are logged out.
      const afterRevocation = await refresh(current);
      expect(afterRevocation.statusCode).toBe(401);

      const families = await familyState(user.id);
      expect(families[0]?.reason).toBe("replay_detected");
      expect(families[0]?.revokedAt).toBeInstanceOf(Date);
    });

    it("rejects a refresh token that was never issued", async () => {
      await registerUser(app);
      const response = await refresh("not-a-real-token");

      expect(response.statusCode).toBe(401);
      expect(response.json<{ code: string }>().code).toBe("UNAUTHENTICATED");
    });

    it("rejects a request with no refresh cookie", async () => {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/refresh" });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("logout", () => {
    it("revokes the family and clears the cookie", async () => {
      const user = await registerUser(app);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: withRefresh(user.refreshCookie),
      });

      expect(response.statusCode).toBe(204);
      expect(String(response.headers["set-cookie"])).toContain("gt_refresh=;");

      const afterLogout = await refresh(user.refreshCookie);
      expect(afterLogout.statusCode).toBe(401);

      expect((await familyState(user.id))[0]?.reason).toBe("logout");
    });

    it("succeeds even with no session, because the goal state is already true", async () => {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/logout" });
      expect(response.statusCode).toBe(204);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 — not 500 — once the auth budget is spent", async () => {
      // Its own app instance with a tiny budget: the shared one is set high so
      // the rest of the suite is not throttled.
      const throttled = await buildTestApp({ AUTH_RATE_LIMIT_MAX: "2" });
      await throttled.ready();

      try {
        const attempt = () =>
          throttled.inject({
            method: "POST",
            url: "/api/v1/auth/login",
            payload: { email: "nobody@example.test", password: "wrong-password-here" },
          });

        expect((await attempt()).statusCode).toBe(401);
        expect((await attempt()).statusCode).toBe(401);

        const limited = await attempt();
        expect(limited.statusCode).toBe(429);
        expect(limited.json<{ code: string }>().code).toBe("RATE_LIMITED");
      } finally {
        await throttled.close();
      }
    });
  });

  describe("access tokens", () => {
    it("identifies the caller on /auth/me", async () => {
      const user = await registerUser(app);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: asUser(user.accessToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { email: string } }>().data.email).toBe(user.email);
    });

    it("rejects a missing, malformed, or tampered token identically", async () => {
      const user = await registerUser(app);

      // Tamper a character in the MIDDLE of the signature, not the last one.
      //
      // An HS256 signature is 32 bytes, which is 43 base64url characters. The
      // final character carries only 4 significant bits — the trailing 2 are
      // discarded on decode — so A, B, C and D all decode to the same byte.
      // Flipping the last char therefore changes NOTHING whenever the signature
      // happens to end in one of those four, the "tampered" token verifies
      // correctly, and this test fails with a 200. One run in sixteen, on a
      // security assertion: it reads as a breach and is not one.
      //
      // Every character away from the boundary contributes all 6 of its bits,
      // so mutating one there always changes the signature.
      const [header, payload, signature] = user.accessToken.split(".");
      const mid = Math.floor(signature!.length / 2);
      const tampered = [
        header,
        payload,
        signature!.slice(0, mid) +
          (signature![mid] === "A" ? "B" : "A") +
          signature!.slice(mid + 1),
      ].join(".");
      expect(tampered).not.toBe(user.accessToken);

      const cases = [
        { headers: {} },
        { headers: { authorization: "Bearer not.a.jwt" } },
        { headers: { authorization: user.accessToken } }, // no "Bearer " scheme
        { headers: asUser(tampered) },
      ];

      for (const testCase of cases) {
        const response = await app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          ...testCase,
        });

        expect(response.statusCode).toBe(401);
        expect(response.json<{ code: string }>().code).toBe("UNAUTHENTICATED");
      }
    });

    it("does not accept a refresh token as an access token", async () => {
      const user = await registerUser(app);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: asUser(user.refreshCookie),
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
