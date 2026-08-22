import { sql } from "kysely";
import { uuidv7 } from "../../db/uuid.js";
import type { Tx } from "../../db/plugin.js";
import type { TransportMode } from "../../db/types.js";

/**
 * SQL only. Stops live in the trips module because they have no independent
 * lifecycle — a stop without a trip is meaningless.
 *
 * `period` is a tstzrange, so arrival and departure are read back through
 * lower()/upper() rather than as columns.
 */

export interface StopRow {
  id: string;
  trip_id: string;
  city_id: string;
  seq: number;
  arrives_at: Date;
  departs_at: Date;
  arrival_mode: TransportMode | null;
  arrival_cost: string;
  lodging_cost: string;
  notes: string | null;
}

const stopSelect = [
  "trip_stops.id",
  "trip_stops.trip_id",
  "trip_stops.city_id",
  "trip_stops.seq",
  "trip_stops.arrival_mode",
  "trip_stops.arrival_cost",
  "trip_stops.lodging_cost",
  "trip_stops.notes",
] as const;

const arrivesAtExpr = sql<Date>`lower(trip_stops.period)`.as("arrives_at");
const departsAtExpr = sql<Date>`upper(trip_stops.period)`.as("departs_at");

/**
 * `[)` half-open, matching how the schema stores every range. Both bounds are
 * Zod-validated ISO instants and travel as bound parameters.
 */
export function toTstzrange(startsAt: string, endsAt: string): string {
  return `[${startsAt},${endsAt})`;
}

export async function listStops(trx: Tx, tripId: string): Promise<StopRow[]> {
  return trx
    .selectFrom("trip_stops")
    .select([...stopSelect, arrivesAtExpr, departsAtExpr])
    .where("trip_stops.trip_id", "=", tripId)
    .orderBy("trip_stops.seq", "asc")
    .execute();
}

export async function findStopById(trx: Tx, stopId: string): Promise<StopRow | undefined> {
  return trx
    .selectFrom("trip_stops")
    .select([...stopSelect, arrivesAtExpr, departsAtExpr])
    .where("trip_stops.id", "=", stopId)
    .executeTakeFirst();
}

/** The next free position. Stops are 1-based (`trip_stops_seq_pos`). */
export async function nextSeq(trx: Tx, tripId: string): Promise<number> {
  const row = await trx
    .selectFrom("trip_stops")
    .select(sql<number>`coalesce(max(seq), 0) + 1`.as("next"))
    .where("trip_id", "=", tripId)
    .executeTakeFirstOrThrow();

  return row.next;
}

export interface InsertStopInput {
  tripId: string;
  cityId: string;
  seq: number;
  arrivesAt: string;
  departsAt: string;
  arrivalMode: TransportMode | null;
  arrivalCost: string;
  lodgingCost: string;
  notes: string | null;
}

/**
 * Same two-statement shape as trips, and for the same reason: RETURNING is
 * subject to the SELECT policy, which is a STABLE function that cannot see the
 * row being inserted. See db/uuid.ts.
 */
export async function insertStop(trx: Tx, input: InsertStopInput): Promise<StopRow> {
  const id = uuidv7();

  await trx
    .insertInto("trip_stops")
    .values({
      id,
      trip_id: input.tripId,
      city_id: input.cityId,
      seq: input.seq,
      period: toTstzrange(input.arrivesAt, input.departsAt),
      arrival_mode: input.arrivalMode,
      arrival_cost: input.arrivalCost,
      lodging_cost: input.lodgingCost,
      notes: input.notes,
    })
    .execute();

  const row = await findStopById(trx, id);
  if (row === undefined) {
    throw new Error(`inserted stop ${id} is not readable by its own transaction`);
  }

  return row;
}

export interface UpdateStopFields {
  cityId?: string;
  period?: string;
  arrivalMode?: TransportMode | null;
  arrivalCost?: string;
  lodgingCost?: string;
  notes?: string | null;
}

export async function updateStop(
  trx: Tx,
  stopId: string,
  fields: UpdateStopFields,
): Promise<StopRow | undefined> {
  const values: Record<string, unknown> = {};
  if (fields.cityId !== undefined) values["city_id"] = fields.cityId;
  if (fields.period !== undefined) values["period"] = fields.period;
  if (fields.arrivalMode !== undefined) values["arrival_mode"] = fields.arrivalMode;
  if (fields.arrivalCost !== undefined) values["arrival_cost"] = fields.arrivalCost;
  if (fields.lodgingCost !== undefined) values["lodging_cost"] = fields.lodgingCost;
  if (fields.notes !== undefined) values["notes"] = fields.notes;

  if (Object.keys(values).length > 0) {
    await trx.updateTable("trip_stops").set(values).where("id", "=", stopId).execute();
  }

  return findStopById(trx, stopId);
}

export async function deleteStop(trx: Tx, stopId: string): Promise<number> {
  const result = await trx.deleteFrom("trip_stops").where("id", "=", stopId).executeTakeFirst();

  return Number(result.numDeletedRows);
}

/** Ids currently belonging to a trip, for validating a reorder request. */
export async function stopIdsForTrip(trx: Tx, tripId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom("trip_stops")
    .select("id")
    .where("trip_id", "=", tripId)
    .execute();

  return rows.map((r) => r.id);
}

/**
 * Reorders every stop in a trip with ONE statement (issue #17: never a loop of
 * UPDATEs from JS).
 *
 * The new positions arrive as a VALUES list joined against the table, so N
 * stops cost one round trip regardless of N. Two properties make this legal:
 *
 *  - `trip_stops_trip_seq_uq` is DEFERRABLE INITIALLY DEFERRED, so the
 *    transient duplicate seq values that any permutation passes through are
 *    not checked until COMMIT.
 *  - the ids are bound parameters, never interpolated.
 *
 * Note there is deliberately no ON CONFLICT here — Postgres rejects a
 * deferrable unique constraint as a conflict arbiter.
 */
export async function reorderStops(
  trx: Tx,
  tripId: string,
  orderedStopIds: readonly string[],
): Promise<void> {
  // Both columns are cast explicitly. Without them Postgres types a bare
  // parameter inside VALUES as `text`, and assigning text to `seq integer`
  // fails with a type error rather than anything that names the real problem.
  const rows = orderedStopIds.map((id, index) => sql`(${id}::uuid, ${index + 1}::int)`);
  const values = sql.join(rows);

  await sql`
    update trip_stops as s
       set seq = v.seq
      from (values ${values}) as v(id, seq)
     where s.id = v.id
       and s.trip_id = ${tripId}::uuid
  `.execute(trx);
}
