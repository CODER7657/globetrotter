import { sql } from "kysely";
import { uuidv7 } from "../../db/uuid.js";
import type { Tx } from "../../db/plugin.js";
import type { UserRole } from "../../db/types.js";

/**
 * SQL only. No Fastify, no HTTP types, no business rules.
 *
 * TWO THINGS HERE ARE UNUSUAL, AND BOTH ARE FORCED BY RLS:
 *
 * 1. Authentication runs *before* an identity exists, so the pre-auth lookups
 *    cannot go through the ordinary policies — `users_self_read` is
 *    `id = app.current_user_id()`, which is exactly what login is trying to
 *    discover. Those two reads go through SECURITY DEFINER functions instead.
 *
 * 2. `INSERT ... RETURNING` is rejected on `users` for the same reason it is on
 *    `trips`: RETURNING is subject to the SELECT policy, which cannot pass for
 *    a row whose owner is not yet the current identity. So ids are supplied by
 *    the application and rows are read back in a second statement.
 */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  email_verified_at: Date | null;
  created_at: Date;
}

/**
 * Publishes an identity onto the current transaction.
 *
 * Signup needs this: the row is inserted before any identity exists, and the
 * read-back is governed by `users_self_read`. Adopting the id we just minted
 * makes the new account visible to the transaction that created it.
 */
export async function adoptIdentity(trx: Tx, userId: string): Promise<void> {
  await sql`select set_config('app.user_id', ${userId}, true)`.execute(trx);
}

/**
 * Pre-auth lookup by email. Goes through app.auth_find_user_by_email because
 * the caller has no identity yet — see the note at the top of this file.
 */
export async function findUserByEmail(trx: Tx, email: string): Promise<UserRow | undefined> {
  const result = await sql<UserRow>`
    select id, email, password_hash, display_name, role, email_verified_at, created_at
      from app.auth_find_user_by_email(${email}::citext)
  `.execute(trx);

  return result.rows[0];
}

/** Post-auth lookup. The ordinary policy covers this one. */
export async function findUserById(trx: Tx, id: string): Promise<UserRow | undefined> {
  return trx
    .selectFrom("users")
    .select([
      "id",
      "email",
      "password_hash",
      "display_name",
      "role",
      "email_verified_at",
      "created_at",
    ])
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

export interface InsertUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
}

export async function insertUser(trx: Tx, input: InsertUserInput): Promise<UserRow> {
  const id = uuidv7();

  await trx
    .insertInto("users")
    .values({
      id,
      email: input.email,
      password_hash: input.passwordHash,
      display_name: input.displayName,
    })
    .execute();

  // Adopt the identity so the read-back passes users_self_read.
  await adoptIdentity(trx, id);

  const row = await findUserById(trx, id);
  if (row === undefined) {
    throw new Error(`inserted user ${id} is not readable by its own transaction`);
  }

  return row;
}

export async function createTokenFamily(
  trx: Tx,
  userId: string,
  userAgent: string | null,
): Promise<string> {
  const id = uuidv7();

  await trx
    .insertInto("refresh_token_families")
    .values({ id, user_id: userId, user_agent: userAgent })
    .execute();

  return id;
}

export interface InsertRefreshTokenInput {
  familyId: string;
  tokenHash: Buffer;
  expiresAt: Date;
}

export async function insertRefreshToken(
  trx: Tx,
  input: InsertRefreshTokenInput,
): Promise<string> {
  const id = uuidv7();

  await trx
    .insertInto("refresh_tokens")
    .values({
      id,
      family_id: input.familyId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
    })
    .execute();

  return id;
}

export interface RefreshTokenLookup {
  tokenId: string;
  familyId: string;
  userId: string;
  consumedAt: Date | null;
  expiresAt: Date;
  familyRevokedAt: Date | null;
}

/**
 * Pre-auth lookup by token hash, joined to its family so one round trip
 * answers all three questions: does it exist, was it already consumed, is the
 * family revoked.
 *
 * Goes through app.auth_find_refresh_token: `refresh_tokens` is readable, but
 * `refresh_token_families` is gated on `user_id = app.current_user_id()`, and
 * during a refresh we do not know the user until we have read this row.
 */
export async function findRefreshTokenByHash(
  trx: Tx,
  tokenHash: Buffer,
): Promise<RefreshTokenLookup | undefined> {
  const result = await sql<{
    token_id: string;
    family_id: string;
    user_id: string;
    consumed_at: Date | null;
    expires_at: Date;
    family_revoked_at: Date | null;
  }>`
    select token_id, family_id, user_id, consumed_at, expires_at, family_revoked_at
      from app.auth_find_refresh_token(${tokenHash})
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) return undefined;

  return {
    tokenId: row.token_id,
    familyId: row.family_id,
    userId: row.user_id,
    consumedAt: row.consumed_at,
    expiresAt: row.expires_at,
    familyRevokedAt: row.family_revoked_at,
  };
}

/**
 * Marks a token rotated.
 *
 * The schema has no `replaced_by` column, so the audit chain is implicit:
 * tokens in a family are ordered by issued_at, and consumed_at says which were
 * rotated. Enough to reconstruct the sequence during an incident.
 */
export async function markTokenConsumed(trx: Tx, tokenId: string): Promise<void> {
  await trx
    .updateTable("refresh_tokens")
    .set({ consumed_at: new Date() })
    .where("id", "=", tokenId)
    .execute();
}

/**
 * Revokes a whole family. Idempotent via the `revoked_at is null` guard, so
 * two concurrent replays cannot overwrite the first recorded reason.
 *
 * `revoked_reason` is free text in this schema, so the values are kept to the
 * fixed set below rather than being invented per call site.
 */
export type RevokeReason = "logout" | "replay_detected" | "password_changed" | "admin_revoked";

export async function revokeFamily(
  trx: Tx,
  familyId: string,
  reason: RevokeReason,
): Promise<void> {
  await trx
    .updateTable("refresh_token_families")
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where("id", "=", familyId)
    .where("revoked_at", "is", null)
    .execute();
}
