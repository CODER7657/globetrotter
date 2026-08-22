import { sql } from "kysely";
import { uuidv7 } from "../../db/uuid.js";
import type { Tx } from "../../db/plugin.js";
import type { CostCategory, TransportMode, TripVisibility } from "../../db/types.js";

/** SQL only. */

export interface ShareRow {
  slug: string;
  created_at: Date;
  revoked_at: Date | null;
  view_count: number;
}

export async function findActiveShare(
  trx: Tx,
  tripId: string,
): Promise<ShareRow | undefined> {
  return trx
    .selectFrom("trip_shares")
    .select(["slug", "created_at", "revoked_at", "view_count"])
    .where("trip_id", "=", tripId)
    .where("revoked_at", "is", null)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}

export async function insertShare(
  trx: Tx,
  input: { tripId: string; createdBy: string; slug: string },
): Promise<ShareRow> {
  const id = uuidv7();

  await trx
    .insertInto("trip_shares")
    .values({
      id,
      trip_id: input.tripId,
      slug: input.slug,
      created_by: input.createdBy,
    })
    .execute();

  const row = await trx
    .selectFrom("trip_shares")
    .select(["slug", "created_at", "revoked_at", "view_count"])
    .where("id", "=", id)
    .executeTakeFirst();

  if (row === undefined) {
    throw new Error(`inserted share ${id} is not readable by its own transaction`);
  }

  return row;
}

/**
 * Revokes every live share for a trip.
 *
 * The rows stay for audit — `revoked_at` is set, nothing is deleted — which is
 * what makes "who could see this, and until when" answerable later.
 */
export async function revokeShares(trx: Tx, tripId: string): Promise<number> {
  const result = await trx
    .updateTable("trip_shares")
    .set({ revoked_at: new Date() })
    .where("trip_id", "=", tripId)
    .where("revoked_at", "is", null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}

export async function setVisibility(
  trx: Tx,
  tripId: string,
  visibility: TripVisibility,
): Promise<void> {
  await trx.updateTable("trips").set({ visibility }).where("id", "=", tripId).execute();
}

/**
 * Bumps the view counter.
 *
 * Currently a no-op from the public path, and deliberately left in place: an
 * anonymous share-slug transaction cannot satisfy `trip_shares_write`, which
 * is FOR ALL and keyed on ownership, so this matches zero rows. It is written
 * as a plain UPDATE rather than something that throws precisely so a missing
 * view count never costs a reader their itinerary.
 *
 * Needs a SECURITY DEFINER `app.record_share_view(text)` to actually count —
 * RLS cannot express "may update this one column". See the PR thread.
 */
export async function recordView(trx: Tx, slug: string): Promise<void> {
  await trx
    .updateTable("trip_shares")
    .set((eb) => ({ view_count: eb("view_count", "+", 1) }))
    .where("slug", "=", slug)
    .where("revoked_at", "is", null)
    .execute();
}

// --------------------------------------------------------------- reading ---

export interface PublicTripRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  visibility: TripVisibility;
  base_currency: string;
  cover_image_url: string | null;
}

/**
 * Resolves a slug to its trip.
 *
 * There is no `WHERE revoked_at IS NULL` here and there does not need to be:
 * `trip_shares_read` only matches a row whose slug equals `app.share_slug`,
 * and `app.can_read_trip` only accepts an unlisted trip whose share row is
 * live. A revoked slug therefore resolves to nothing by policy, not by a
 * predicate someone could forget to write.
 */
export async function findTripBySlug(
  trx: Tx,
  slug: string,
): Promise<PublicTripRow | undefined> {
  return trx
    .selectFrom("trip_shares")
    .innerJoin("trips", "trips.id", "trip_shares.trip_id")
    .select([
      "trips.id",
      "trips.name",
      "trips.description",
      "trips.visibility",
      "trips.base_currency",
      "trips.cover_image_url",
      sql<string>`lower(trips.period)::text`.as("start_date"),
      sql<string>`(upper(trips.period) - 1)::text`.as("end_date"),
    ])
    .where("trip_shares.slug", "=", slug)
    .where("trips.deleted_at", "is", null)
    .executeTakeFirst();
}

export interface PublicStopRow {
  id: string;
  city_id: string;
  city_name: string;
  country_code: string;
  seq: number;
  arrives_at: Date;
  departs_at: Date;
  arrival_mode: TransportMode | null;
  arrival_cost: string;
  lodging_cost: string;
  notes: string | null;
}

export async function listPublicStops(trx: Tx, tripId: string): Promise<PublicStopRow[]> {
  return trx
    .selectFrom("trip_stops")
    .innerJoin("cities", "cities.id", "trip_stops.city_id")
    .select([
      "trip_stops.id",
      "trip_stops.city_id",
      "cities.name as city_name",
      "cities.country_code",
      "trip_stops.seq",
      "trip_stops.arrival_mode",
      "trip_stops.arrival_cost",
      "trip_stops.lodging_cost",
      "trip_stops.notes",
      sql<Date>`lower(trip_stops.period)`.as("arrives_at"),
      sql<Date>`upper(trip_stops.period)`.as("departs_at"),
    ])
    .where("trip_stops.trip_id", "=", tripId)
    .orderBy("trip_stops.seq", "asc")
    .execute();
}

export interface PublicActivityRow {
  id: string;
  stop_id: string;
  activity_id: string | null;
  title: string;
  starts_at: Date;
  ends_at: Date;
  category: CostCategory;
  cost_amount: string;
  notes: string | null;
}

/** One query for every activity in the trip, rather than one per stop. */
export async function listActivitiesForStops(
  trx: Tx,
  stopIds: readonly string[],
): Promise<PublicActivityRow[]> {
  if (stopIds.length === 0) return [];

  return trx
    .selectFrom("trip_activities")
    .select([
      "id",
      "stop_id",
      "activity_id",
      "title",
      "category",
      "cost_amount",
      "notes",
      sql<Date>`lower(slot)`.as("starts_at"),
      sql<Date>`upper(slot)`.as("ends_at"),
    ])
    .where("stop_id", "in", [...stopIds])
    .orderBy(sql`lower(slot)`, "asc")
    .execute();
}

// ---------------------------------------------------------------- copying ---

export interface CopyTripInput {
  sourceTripId: string;
  newOwnerId: string;
  name: string;
}

export interface CopyResult {
  tripId: string;
  stopCount: number;
  activityCount: number;
}

/**
 * Deep-clones a trip. The caller must already be inside a transaction, which
 * is what makes this atomic (issue #20): a failure at the activity stage
 * leaves no half-copied trip behind.
 *
 * Stops and activities are inserted as two multi-row statements rather than a
 * loop, so a 20-stop itinerary costs a fixed number of round trips.
 *
 * The copy is always a `draft`, private, and owned by the caller. Copying
 * someone's public trip must never make you look like a collaborator on
 * theirs, and `trips_owner_no_overlap` only constrains committed trips — so a
 * draft copy cannot collide with the caller's existing plans.
 */
export async function copyTripGraph(trx: Tx, input: CopyTripInput): Promise<CopyResult> {
  const newTripId = uuidv7();

  // The source period is copied verbatim; the stops inside it keep their
  // absolute times, so shifting the trip would strand every one of them.
  await sql`
    insert into trips (id, owner_id, name, description, period, base_currency,
                       budget_cap, cover_image_url, status, visibility)
    select ${newTripId}::uuid, ${input.newOwnerId}::uuid, ${input.name},
           t.description, t.period, t.base_currency, t.budget_cap,
           t.cover_image_url, 'draft', 'private'
      from trips t
     where t.id = ${input.sourceTripId}::uuid
  `.execute(trx);

  const sourceStops = await trx
    .selectFrom("trip_stops")
    .select(["id", "seq"])
    .where("trip_id", "=", input.sourceTripId)
    .orderBy("seq", "asc")
    .execute();

  if (sourceStops.length === 0) {
    return { tripId: newTripId, stopCount: 0, activityCount: 0 };
  }

  // New ids are minted up front so activities can be pointed at their copied
  // parent without a second round trip per stop.
  const stopIdMap = new Map(sourceStops.map((s) => [s.id, uuidv7()]));

  const stopPairs = [...stopIdMap].map(
    ([oldId, newId]) => sql`(${oldId}::uuid, ${newId}::uuid)`,
  );

  await sql`
    insert into trip_stops (id, trip_id, city_id, seq, period, arrival_mode,
                            arrival_cost, lodging_cost, notes)
    select m.new_id, ${newTripId}::uuid, s.city_id, s.seq, s.period,
           s.arrival_mode, s.arrival_cost, s.lodging_cost, s.notes
      from trip_stops s
      join (values ${sql.join(stopPairs)}) as m(old_id, new_id) on m.old_id = s.id
  `.execute(trx);

  const activityPairs = [...stopIdMap].map(
    ([oldId, newId]) => sql`(${oldId}::uuid, ${newId}::uuid)`,
  );

  const inserted = await sql<{ count: string }>`
    with copied as (
      insert into trip_activities (id, stop_id, activity_id, title, slot,
                                   category, cost_amount, notes)
      select uuidv7(), m.new_id, a.activity_id, a.title, a.slot,
             a.category, a.cost_amount, a.notes
        from trip_activities a
        join (values ${sql.join(activityPairs)}) as m(old_id, new_id)
          on m.old_id = a.stop_id
      returning 1
    )
    select count(*)::text as count from copied
  `.execute(trx);

  return {
    tripId: newTripId,
    stopCount: stopIdMap.size,
    activityCount: Number(inserted.rows[0]?.count ?? 0),
  };
}
