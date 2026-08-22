import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import type { UserId } from "@globetrotter/contracts";

/**
 * Test harness. Builds a real app against a real Postgres — no mocked query
 * layer, because a mock cannot tell you whether an RLS policy works, and RLS
 * is where the authorization actually lives (#45).
 *
 * Two connections, deliberately:
 *
 *   app   -> globetrotter_app  (NOBYPASSRLS)  the code under test
 *   admin -> postgres          (superuser)    fixtures and teardown only
 *
 * If fixtures went through the app's connection, RLS would block them and the
 * tests would quietly start testing nothing.
 */

const TEST_DATABASE_URL =
  process.env["APP_DATABASE_URL"] ??
  "postgresql://globetrotter_app:globetrotter_app@127.0.0.1:5432/globetrotter";

const ADMIN_DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:5432/globetrotter";

let adminPool: pg.Pool | undefined;

function admin(): pg.Pool {
  adminPool ??= new pg.Pool({ connectionString: ADMIN_DATABASE_URL, max: 4 });
  return adminPool;
}

export async function buildTestApp(
  overrides: Record<string, string> = {},
): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    APP_DATABASE_URL: TEST_DATABASE_URL,
    CORS_ORIGINS: "http://localhost:5173",
    JWT_SECRET: "test-only-secret-must-be-at-least-32-chars-long",
    // Short enough that an expiry test does not have to sleep for minutes.
    ACCESS_TOKEN_TTL_SECONDS: "60",
    REFRESH_TOKEN_TTL_SECONDS: "3600",
    // The production budget (10/min) would throttle the suite itself. The
    // limit is exercised deliberately by its own test, which builds an app
    // with a small max rather than relying on the default.
    AUTH_RATE_LIMIT_MAX: "1000",
    ...overrides,
  });

  return buildApp(config);
}

/**
 * Fixture-only escape hatch. Runs as the superuser, so it bypasses RLS — use it
 * to ARRANGE and ASSERT on stored state, never to exercise a code path. Any
 * test that reaches through this to make an app behaviour pass is lying.
 */
export async function adminQuery<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await admin().query(sql, params);
  return result.rows as T[];
}

/** Closes the fixture connection. Call from afterAll alongside app.close(). */
export async function closeHarness(): Promise<void> {
  await adminPool?.end();
  adminPool = undefined;
}

/** A password that clears the zxcvbn score-3 gate. */
export const STRONG_PASSWORD = "correct-horse-battery-staple-72";

export interface TestSession {
  id: UserId;
  email: string;
  password: string;
  accessToken: string;
  /** Raw refresh cookie value, for replay tests. */
  refreshCookie: string;
}

/**
 * Registers a user through the real signup endpoint.
 *
 * Deliberately not an INSERT: going through the API means every test exercises
 * password hashing and token issuance, so a break in either surfaces
 * everywhere rather than only in the auth suite.
 */
export async function registerUser(
  app: FastifyInstance,
  overrides: { email?: string; password?: string } = {},
): Promise<TestSession> {
  const email = overrides.email ?? `test-${randomUUID()}@example.test`;
  const password = overrides.password ?? STRONG_PASSWORD;

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email, password, displayName: "Test User" },
  });

  if (response.statusCode !== 201) {
    throw new Error(`signup failed (${response.statusCode}): ${response.body}`);
  }

  const body = response.json<{ data: { accessToken: string; user: { id: string } } }>();

  return {
    id: body.data.user.id as UserId,
    email,
    password,
    accessToken: body.data.accessToken,
    refreshCookie: refreshCookieFrom(response.headers["set-cookie"]),
  };
}

/** Extracts the `gt_refresh` cookie value from a Set-Cookie header. */
export function refreshCookieFrom(setCookie: string | string[] | undefined): string {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const match = headers.find((c) => c.startsWith("gt_refresh="));

  if (match === undefined) throw new Error("no gt_refresh cookie in response");

  return match.split(";")[0]?.split("=")[1] ?? "";
}

/**
 * Picks seeded cities from the catalogue.
 *
 * The catalogue is reference data owned by db/seed, not test fixtures — so
 * tests read it and must never write it. `truncateAll` leaves it alone for the
 * same reason.
 */
export async function pickCities(count = 1): Promise<string[]> {
  const { rows } = await admin().query<{ id: string }>(
    `SELECT id FROM cities ORDER BY name LIMIT $1`,
    [count],
  );

  if (rows.length < count) {
    throw new Error(`need ${count} seeded cities, found ${rows.length} — is db/seed applied?`);
  }

  return rows.map((r) => r.id);
}

export async function pickCity(): Promise<string> {
  const [city] = await pickCities(1);
  if (city === undefined) throw new Error("no seeded cities");
  return city;
}

/**
 * Wipes the test data.
 *
 * TRUNCATE, not DELETE: `trips` has row-level security, so a DELETE with
 * `app.user_id` unset removes zero rows and leaves the table full. TRUNCATE is
 * not subject to RLS policies.
 */
export async function truncateAll(): Promise<void> {
  // cities and activities are seeded reference data, NOT fixtures. Truncating
  // them CASCADEs through every trip and leaves the catalogue empty for the
  // rest of the run.
  await admin().query(
    `TRUNCATE TABLE
       trip_activities, trip_stops, trip_collaborators, trip_shares,
       trips, refresh_tokens, refresh_token_families, users
     RESTART IDENTITY CASCADE`,
  );
}

/** Reads a token family's revocation state — used to assert replay handling. */
export async function familyState(
  userId: string,
): Promise<{ revokedAt: Date | null; reason: string | null }[]> {
  const { rows } = await admin().query<{ revoked_at: Date | null; revoked_reason: string | null }>(
    `SELECT revoked_at, revoked_reason FROM refresh_token_families
      WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );

  return rows.map((r) => ({ revokedAt: r.revoked_at, reason: r.revoked_reason }));
}

/** Authorization header for an access token. */
export const asUser = (accessToken: string): Record<string, string> => ({
  authorization: `Bearer ${accessToken}`,
});

/** Cookie header carrying a refresh token. */
export const withRefresh = (cookie: string): Record<string, string> => ({
  cookie: `gt_refresh=${cookie}`,
});
