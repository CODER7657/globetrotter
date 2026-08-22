import { sql } from "kysely";
import type { Tx } from "../../db/plugin.js";
import type { CollaboratorRole } from "../../db/types.js";

/** SQL only. */

export interface CollaboratorRow {
  trip_id: string;
  user_id: string;
  role: CollaboratorRole;
  invited_by: string | null;
  created_at: Date;
}

export async function listCollaborators(
  trx: Tx,
  tripId: string,
): Promise<CollaboratorRow[]> {
  // Deliberately no join to `users`. users_self_read restricts the caller to
  // their own row, so joining to fetch a display name silently drops every
  // collaborator but the caller — an inner join that returns nothing.
  return trx
    .selectFrom("trip_collaborators")
    .select(["trip_id", "user_id", "role", "invited_by", "created_at"])
    .where("trip_id", "=", tripId)
    .orderBy("created_at", "asc")
    .execute();
}

/**
 * Resolves an invitee by email.
 *
 * Goes through app.auth_find_user_by_email — the same SECURITY DEFINER
 * function login uses — because `users_self_read` restricts an ordinary SELECT
 * to the caller's own row, so a normal query would find nobody but themselves.
 *
 * The caller only learns whether one specific address exists, and only while
 * holding a trip they own, so this is not a general enumeration surface.
 */
export async function findUserIdByEmail(trx: Tx, email: string): Promise<string | undefined> {
  const result = await sql<{ id: string }>`
    select id from app.auth_find_user_by_email(${email}::citext)
  `.execute(trx);

  return result.rows[0]?.id;
}

export async function insertCollaborator(
  trx: Tx,
  input: { tripId: string; userId: string; role: CollaboratorRole; invitedBy: string },
): Promise<void> {
  await trx
    .insertInto("trip_collaborators")
    .values({
      trip_id: input.tripId,
      user_id: input.userId,
      role: input.role,
      invited_by: input.invitedBy,
    })
    .execute();
}

export async function deleteCollaborator(
  trx: Tx,
  tripId: string,
  userId: string,
): Promise<number> {
  const result = await trx
    .deleteFrom("trip_collaborators")
    .where("trip_id", "=", tripId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  return Number(result.numDeletedRows);
}
