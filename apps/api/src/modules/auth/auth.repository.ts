import type { Selectable } from "kysely";
import type { Tx } from "../../db/plugin.js";
import type { TokenRevokeReason, UsersTable } from "../../db/types.js";

/** SQL only. No Fastify, no HTTP types, no business rules. */

export type UserRow = Selectable<UsersTable>;

export async function findUserByEmail(trx: Tx, email: string): Promise<UserRow | undefined> {
  return trx
    .selectFrom("users")
    .selectAll()
    .where("email", "=", email)
    // A suspended account must not be able to log back in (issue #21).
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

export async function findUserById(trx: Tx, id: string): Promise<UserRow | undefined> {
  return trx
    .selectFrom("users")
    .selectAll()
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
  return trx
    .insertInto("users")
    .values({
      email: input.email,
      password_hash: input.passwordHash,
      display_name: input.displayName,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createTokenFamily(
  trx: Tx,
  userId: string,
  userAgent: string | null,
): Promise<string> {
  const row = await trx
    .insertInto("refresh_token_families")
    .values({ user_id: userId, user_agent: userAgent })
    .returning("id")
    .executeTakeFirstOrThrow();

  return row.id;
}

export interface InsertRefreshTokenInput {
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export async function insertRefreshToken(
  trx: Tx,
  input: InsertRefreshTokenInput,
): Promise<string> {
  const row = await trx
    .insertInto("refresh_tokens")
    .values({
      family_id: input.familyId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return row.id;
}

export interface RefreshTokenLookup {
  tokenId: string;
  familyId: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
  familyRevokedAt: Date | null;
}

/**
 * Looks a token up by hash, joined to its family so one round trip answers all
 * three questions: does it exist, was it already used, is the family revoked.
 */
export async function findRefreshTokenByHash(
  trx: Tx,
  tokenHash: string,
  options: { lock?: boolean } = {},
): Promise<RefreshTokenLookup | undefined> {
  let query = trx
    .selectFrom("refresh_tokens as rt")
    .innerJoin("refresh_token_families as f", "f.id", "rt.family_id")
    .select([
      "rt.id as tokenId",
      "rt.family_id as familyId",
      "f.user_id as userId",
      "rt.used_at as usedAt",
      "rt.expires_at as expiresAt",
      "f.revoked_at as familyRevokedAt",
    ])
    .where("rt.token_hash", "=", tokenHash);

  if (options.lock === true) {
    // Serialises concurrent rotations of the same token.
    query = query.forUpdate();
  }

  return query.executeTakeFirst();
}

/** Marks a token rotated and records what replaced it, for the audit chain. */
export async function markTokenUsed(
  trx: Tx,
  tokenId: string,
  replacedBy: string,
): Promise<void> {
  await trx
    .updateTable("refresh_tokens")
    .set({ used_at: new Date(), replaced_by: replacedBy })
    .where("id", "=", tokenId)
    .execute();
}

/**
 * Revokes a whole family. Idempotent via the `revoked_at is null` guard, so
 * two concurrent replays cannot overwrite the first recorded reason.
 */
export async function revokeFamily(
  trx: Tx,
  familyId: string,
  reason: TokenRevokeReason,
): Promise<void> {
  await trx
    .updateTable("refresh_token_families")
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where("id", "=", familyId)
    .where("revoked_at", "is", null)
    .execute();
}
