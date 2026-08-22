import type { Selectable } from "kysely";
import type { Tx } from "../../db/plugin.js";
import type { TripsTable } from "../../db/types.js";

/**
 * SQL only. This file must not import Fastify, contracts, or anything that
 * knows what HTTP is — enforced by eslint-plugin-boundaries.
 *
 * Every function takes a `Tx`, never a pool. That is what guarantees the RLS
 * identity set by withTx() is in scope for the query.
 */

export type TripRow = Selectable<TripsTable>;

export interface InsertTripInput {
  ownerId: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  coverImageUrl: string | null;
}

export async function insertTrip(trx: Tx, input: InsertTripInput): Promise<TripRow> {
  return trx
    .insertInto("trips")
    .values({
      owner_id: input.ownerId,
      title: input.title,
      description: input.description,
      start_date: input.startDate,
      end_date: input.endDate,
      cover_image_url: input.coverImageUrl,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function findTripById(trx: Tx, id: string): Promise<TripRow | undefined> {
  return trx.selectFrom("trips").selectAll().where("id", "=", id).executeTakeFirst();
}

export interface ListTripsInput {
  ownerId: string;
  /** Keyset cursor: the last id of the previous page. */
  afterId: string | undefined;
  limit: number;
}

/**
 * Keyset pagination on the primary key. Sound because ids are UUIDv7 and
 * therefore monotonically ordered by creation time — no offset scan, and no
 * page drift when rows are inserted mid-listing.
 *
 * Fetches limit+1 rows so `hasMore` needs no second COUNT query.
 */
export async function listTripsByOwner(trx: Tx, input: ListTripsInput): Promise<TripRow[]> {
  let query = trx
    .selectFrom("trips")
    .selectAll()
    .where("owner_id", "=", input.ownerId)
    .orderBy("id", "desc")
    .limit(input.limit + 1);

  if (input.afterId !== undefined) {
    query = query.where("id", "<", input.afterId);
  }

  return query.execute();
}
