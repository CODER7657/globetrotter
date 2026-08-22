import fp from "fastify-plugin";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import type { Transaction } from "kysely";
import type { Config } from "../config.js";
import type { Database } from "./types.js";

/**
 * DATE (oid 1082) must stay a `YYYY-MM-DD` string. node-pg's default parser
 * turns it into a Date at the server's local midnight, which silently shifts
 * a trip's start date across a timezone boundary.
 */
pg.types.setTypeParser(1082, (value) => value);

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

/**
 * Runs `fn` inside one transaction, with the caller's identity published to
 * Postgres as `app.user_id` for the life of that transaction. Row-Level
 * Security policies read it via current_app_user_id().
 *
 * This is the *only* sanctioned way to touch the database from a service.
 * Querying `app.db` directly bypasses RLS and is a review-blocking mistake.
 */
export type WithTx = <T>(
  userId: string | null,
  fn: (trx: Tx) => Promise<T>,
) => Promise<T>;

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    withTx: WithTx;
  }
}

async function databasePlugin(app: FastifyInstance, config: Config): Promise<void> {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    // A runaway query must not hold a pool slot forever.
    statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on("error", (error) => {
    app.log.error({ err: error }, "idle postgres client errored");
  });

  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  const withTx: WithTx = (userId, fn) =>
    db.transaction().execute(async (trx) => {
      // `true` scopes the setting to this transaction, so a pooled connection
      // never leaks one request's identity into the next.
      await sql`select set_config('app.user_id', ${userId ?? ""}, true)`.execute(trx);
      return fn(trx);
    });

  app.decorate("db", db);
  app.decorate("withTx", withTx);

  app.addHook("onClose", async () => {
    await db.destroy();
  });
}

export default fp(databasePlugin, { name: "db" });
