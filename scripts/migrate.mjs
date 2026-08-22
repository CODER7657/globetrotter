#!/usr/bin/env node
/**
 * Hand-rolled migration runner. No ORM auto-migrate, ever (issue #1).
 *
 *   node scripts/migrate.mjs up      apply all pending .up.sql files
 *   node scripts/migrate.mjs down    revert the most recent applied migration
 *   node scripts/migrate.mjs status  list applied / pending
 *
 * Each migration runs inside a single transaction, so a failure leaves the
 * schema exactly as it was.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

/**
 * Migrations run as the OWNER, not as the application role. globetrotter_app
 * is intentionally powerless to alter the schema (see 0002_app_role), so
 * reusing DATABASE_URL here would fail — hence a separate variable.
 */
const DATABASE_URL =
  process.env.ADMIN_DATABASE_URL ??
  "postgres://globetrotter:globetrotter@127.0.0.1:5433/globetrotter";

/** @returns {{ name: string, up: string, down: string }[]} sorted by filename. */
function loadMigrations() {
  const names = [
    ...new Set(
      readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".up.sql"))
        .map((f) => f.replace(/\.up\.sql$/, "")),
    ),
  ].sort();

  return names.map((name) => ({
    name,
    up: join(MIGRATIONS_DIR, `${name}.up.sql`),
    down: join(MIGRATIONS_DIR, `${name}.down.sql`),
  }));
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedNames(client) {
  const { rows } = await client.query("SELECT name FROM schema_migrations ORDER BY name");
  return rows.map((r) => r.name);
}

async function up(client) {
  const applied = new Set(await appliedNames(client));
  const pending = loadMigrations().filter((m) => !applied.has(m.name));

  if (pending.length === 0) {
    console.log("nothing to apply — schema is current");
    return;
  }

  for (const migration of pending) {
    const sql = readFileSync(migration.up, "utf8");
    const started = Date.now();
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
      await client.query("COMMIT");
      console.log(`applied  ${migration.name}  (${Date.now() - started}ms)`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`FAILED   ${migration.name}\n${error.message}`);
      throw error;
    }
  }
}

async function down(client) {
  const applied = await appliedNames(client);
  const last = applied.at(-1);

  if (last === undefined) {
    console.log("nothing to revert");
    return;
  }

  const migration = loadMigrations().find((m) => m.name === last);
  if (migration === undefined) {
    throw new Error(`migration ${last} is recorded as applied but its files are missing`);
  }

  const sql = readFileSync(migration.down, "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE name = $1", [last]);
    await client.query("COMMIT");
    console.log(`reverted ${last}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`FAILED   ${last}\n${error.message}`);
    throw error;
  }
}

async function status(client) {
  const applied = new Set(await appliedNames(client));
  for (const migration of loadMigrations()) {
    console.log(`${applied.has(migration.name) ? "applied" : "pending"}  ${migration.name}`);
  }
}

const commands = { up, down, status };

async function main() {
  const command = process.argv[2] ?? "up";
  const run = commands[command];

  if (run === undefined) {
    console.error(`unknown command: ${command} (expected up | down | status)`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await ensureLedger(client);
    await run(client);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
