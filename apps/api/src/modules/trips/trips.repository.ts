import { sql } from "kysely";
import { uuidv7 } from "../../db/uuid.js";
import type { Tx } from "../../db/plugin.js";
import type { TripStatus, TripVisibility } from "../../db/types.js";

/**
 * SQL only. This file must not import Fastify, contracts, or anything that
 * knows what HTTP is — enforced by eslint-plugin-boundaries.
 *
 * Every function takes a `Tx`, never a pool. That is what guarantees the RLS
 * identity set by withTx() is in scope for the query.
 */

/**
 * A trip as the API needs it: the stored `period` is projected back into the
 * inclusive start/end pair the contract speaks.
 *
 * `upper(period) - 1` undoes the half-open storage. Doing it here, in the SQL
 * layer, keeps the one place that knows about `[)` next to the one place that
 * writes it.
 */
export interface TripRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: TripStatus;
  visibility: TripVisibility;
  base_currency: string;
  budget_cap: string | null;
  cover_image_url: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** The projection every read below shares. */
const tripColumns = [
  "trips.id",
  "trips.owner_id",
  "trips.name",
  "trips.description",
  "trips.status",
  "trips.visibility",
  "trips.base_currency",
  "trips.budget_cap",
  "trips.cover_image_url",
  "trips.version",
  "trips.created_at",
  "trips.updated_at",
] as const;

const startDateExpr = sql<string>`lower(trips.period)::text`.as("start_date");
const endDateExpr = sql<string>`(upper(trips.period) - 1)::text`.as("end_date");

/**
 * Builds the `[)` daterange text Postgres stores.
 *
 * The API's endDate is inclusive, the stored upper bound is exclusive, so the
 * upper bound is endDate + 1 day. Both values are Zod-validated `YYYY-MM-DD`
 * and this string is passed as a bound parameter, never spliced into SQL.
 */
export function toDaterange(startDate: string, endDateInclusive: string): string {
  const exclusiveUpper = new Date(`${endDateInclusive}T00:00:00Z`);
  exclusiveUpper.setUTCDate(exclusiveUpper.getUTCDate() + 1);
  const upper = exclusiveUpper.toISOString().slice(0, 10);

  return `[${startDate},${upper})`;
}

export interface InsertTripInput {
  ownerId: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  baseCurrency: string;
  budgetCap: string | null;
  coverImageUrl: string | null;
}

/**
 * Inserts a trip and reads it back.
 *
 * Deliberately two statements rather than `INSERT ... RETURNING`. RETURNING is
 * subject to the SELECT policy, and `trips_read` calls the STABLE function
 * `app.can_read_trip(id)`, which evaluates against the statement snapshot and
 * therefore cannot see the row being inserted — so RETURNING is rejected with
 * "new row violates row-level security policy".
 *
 * The follow-up SELECT gets a fresh snapshot and succeeds. Both statements are
 * in one transaction, so this is still atomic. See db/uuid.ts for why the id
 * is supplied here instead of by the column DEFAULT.
 */
export async function insertTrip(trx: Tx, input: InsertTripInput): Promise<TripRow> {
  const id = uuidv7();

  await trx
    .insertInto("trips")
    .values({
      id,
      owner_id: input.ownerId,
      name: input.name,
      description: input.description,
      period: toDaterange(input.startDate, input.endDate),
      base_currency: input.baseCurrency,
      budget_cap: input.budgetCap,
      cover_image_url: input.coverImageUrl,
    })
    .execute();

  const row = await findTripById(trx, id);
  if (row === undefined) {
    // Only reachable if the SELECT policy rejects a row this user just
    // created, which would mean the policies contradict each other.
    throw new Error(`inserted trip ${id} is not readable by its own creator`);
  }

  return row;
}

export async function findTripById(trx: Tx, id: string): Promise<TripRow | undefined> {
  return trx
    .selectFrom("trips")
    .select([...tripColumns, startDateExpr, endDateExpr])
    .where("trips.id", "=", id)
    // Soft-deleted trips are gone as far as the API is concerned.
    .where("trips.deleted_at", "is", null)
    .executeTakeFirst();
}

export interface ListTripsInput {
  ownerId: string;
  /** Keyset cursor: the last id of the previous page. */
  afterId: string | undefined;
  limit: number;
}

/**
 * Keyset pagination on the primary key. Sound because ids are UUIDv7 and
 * therefore ordered by creation time — no offset scan, and no page drift when
 * rows are inserted mid-listing.
 *
 * Fetches limit+1 rows so `hasMore` needs no second COUNT query.
 */
export async function listTripsByOwner(trx: Tx, input: ListTripsInput): Promise<TripRow[]> {
  let query = trx
    .selectFrom("trips")
    .select([...tripColumns, startDateExpr, endDateExpr])
    .where("trips.owner_id", "=", input.ownerId)
    .where("trips.deleted_at", "is", null)
    .orderBy("trips.id", "desc")
    .limit(input.limit + 1);

  if (input.afterId !== undefined) {
    query = query.where("trips.id", "<", input.afterId);
  }

  return query.execute();
}

export interface UpdateTripFields {
  name?: string;
  description?: string | null;
  period?: string;
  status?: TripStatus;
  visibility?: TripVisibility;
  budgetCap?: string | null;
  coverImageUrl?: string | null;
}

/**
 * Applies a partial update. Returns undefined if the row is not visible to
 * the caller, which RLS decides.
 *
 * The version is bumped HERE, in the same statement as the change.
 *
 * `notify_trip_change` bumps it for stops and activities but deliberately
 * NOT for trips, to avoid re-firing itself (009_realtime). So a trip-level
 * edit — a rename, a date change — would otherwise leave the version
 * untouched, and two people renaming the same trip could not detect each
 * other. If-Match would appear to work while guarding nothing.
 *
 * Doing it in the same UPDATE rather than a follow-up statement is what keeps
 * the trigger's recursion concern from applying: there is one UPDATE, so one
 * trigger invocation, and the NOTIFY it emits already carries the new version.
 */
export async function updateTrip(
  trx: Tx,
  tripId: string,
  fields: UpdateTripFields,
): Promise<TripRow | undefined> {
  const values: Record<string, unknown> = {};
  if (fields.name !== undefined) values["name"] = fields.name;
  if (fields.description !== undefined) values["description"] = fields.description;
  if (fields.period !== undefined) values["period"] = fields.period;
  if (fields.status !== undefined) values["status"] = fields.status;
  if (fields.visibility !== undefined) values["visibility"] = fields.visibility;
  if (fields.budgetCap !== undefined) values["budget_cap"] = fields.budgetCap;
  if (fields.coverImageUrl !== undefined) values["cover_image_url"] = fields.coverImageUrl;

  if (Object.keys(values).length > 0) {
    await trx
      .updateTable("trips")
      .set({ ...values, version: sql<number>`version + 1` })
      .where("id", "=", tripId)
      .where("deleted_at", "is", null)
      .execute();
  }

  return findTripById(trx, tripId);
}

/**
 * Soft-deletes a trip.
 *
 * Never a hard DELETE: trips are referenced by trip_events, whose whole point
 * is to survive the thing it describes, and by trip_shares kept for audit.
 */
export async function softDeleteTrip(trx: Tx, tripId: string): Promise<number> {
  const result = await trx
    .updateTable("trips")
    .set({ deleted_at: new Date() })
    .where("id", "=", tripId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}
