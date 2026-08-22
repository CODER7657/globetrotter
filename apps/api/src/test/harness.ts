import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import type { UserId } from "@globetrotter/contracts";

/**
 * Test harness. Builds a real app against a real Postgres — no mocked query
 * layer, because a mock cannot tell you whether an RLS policy works, and RLS
 * is where the authorization actually lives (issue #4).
 *
 * Two connections, deliberately:
 *
 *   app   -> globetrotter_app  (NOBYPASSRLS)  the code under test
 *   admin -> globetrotter      (superuser)    fixtures and teardown only
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

export async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    APP_DATABASE_URL: TEST_DATABASE_URL,
    CORS_ORIGINS: "http://localhost:5173",
  });

  return buildApp(config);
}

/** Closes the fixture connection. Call from afterAll alongside app.close(). */
export async function closeHarness(): Promise<void> {
  await adminPool?.end();
  adminPool = undefined;
}

export interface SeededUser {
  id: UserId;
  email: string;
}

export async function seedUser(): Promise<SeededUser> {
  const email = `test-${randomUUID()}@example.test`;

  const { rows } = await admin().query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    // Not a real Argon2id hash — nothing in the skeleton verifies it yet.
    [email, "placeholder-until-issue-15", "Test User"],
  );

  const row = rows[0];
  if (row === undefined) throw new Error("failed to seed user");

  return { id: row.id as UserId, email };
}

/**
 * The catalog is read-only to the API role, so cities are seeded through the
 * admin connection. Until @pavan's #8 lands there is no city data at all.
 */
export async function seedCity(name = "Lisbon", countryCode = "PT"): Promise<string> {
  const { rows } = await admin().query<{ id: string }>(
    `INSERT INTO cities (country_code, name, slug, latitude, longitude, timezone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [countryCode, name, `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
     "38.7223", "-9.1393", "Europe/Lisbon"],
  );

  const row = rows[0];
  if (row === undefined) throw new Error("failed to seed city");

  return row.id;
}

/**
 * Wipes the test data.
 *
 * TRUNCATE, not DELETE: `trips` has FORCE ROW LEVEL SECURITY, so a DELETE with
 * `app.user_id` unset removes zero rows and leaves the table full. TRUNCATE is
 * not subject to RLS policies.
 */
export async function truncateAll(): Promise<void> {
  await admin().query(
    `TRUNCATE TABLE
       trip_activities, trip_stops, trip_collaborators, trip_shares,
       trips, refresh_tokens, refresh_token_families, cities, users
     RESTART IDENTITY CASCADE`,
  );
}

/** Headers standing in for authentication until issue #15 lands. */
export const asUser = (userId: UserId): Record<string, string> => ({
  "x-user-id": userId,
});
