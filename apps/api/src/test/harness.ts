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
  process.env["TEST_DATABASE_URL"] ??
  "postgres://globetrotter_app:globetrotter_app@127.0.0.1:5433/globetrotter";

const ADMIN_DATABASE_URL =
  process.env["ADMIN_DATABASE_URL"] ??
  "postgres://globetrotter:globetrotter@127.0.0.1:5433/globetrotter";

let adminPool: pg.Pool | undefined;

function admin(): pg.Pool {
  adminPool ??= new pg.Pool({ connectionString: ADMIN_DATABASE_URL, max: 4 });
  return adminPool;
}

export async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
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

export async function seedCity(name = "Lisbon", countryCode = "PT"): Promise<string> {
  const { rows } = await admin().query<{ id: string }>(
    `INSERT INTO cities (name, country_code) VALUES ($1, $2) RETURNING id`,
    [name, countryCode],
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
       trip_activities, trip_stops, trips, activities, cities, users
     RESTART IDENTITY CASCADE`,
  );
}

/** Headers standing in for authentication until issue #15 lands. */
export const asUser = (userId: UserId): Record<string, string> => ({
  "x-user-id": userId,
});
