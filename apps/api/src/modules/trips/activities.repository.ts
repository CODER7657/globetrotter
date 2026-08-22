import { sql } from "kysely";
import { uuidv7 } from "../../db/uuid.js";
import type { Tx } from "../../db/plugin.js";
import type { CostCategory } from "../../db/types.js";

/**
 * SQL only, for activities *scheduled inside a trip* — not the catalogue.
 *
 * `trip_activities` is a temporal table: its primary key is
 * `(id, slot WITHOUT OVERLAPS)`, so in principle one id can carry several rows
 * with disjoint slots. We never exercise that — every scheduled activity is
 * created once with a fresh uuidv7 — but it is why the reads below are written
 * to return a single deterministic row rather than assuming id is unique.
 */

export interface TripActivityRow {
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

const activitySelect = [
  "trip_activities.id",
  "trip_activities.stop_id",
  "trip_activities.activity_id",
  "trip_activities.title",
  "trip_activities.category",
  "trip_activities.cost_amount",
  "trip_activities.notes",
] as const;

const startsAtExpr = sql<Date>`lower(trip_activities.slot)`.as("starts_at");
const endsAtExpr = sql<Date>`upper(trip_activities.slot)`.as("ends_at");

/** `[)` half-open, matching every other range in the schema. */
export function toSlot(startsAt: string, endsAt: string): string {
  return `[${startsAt},${endsAt})`;
}

export async function listActivitiesForStop(
  trx: Tx,
  stopId: string,
): Promise<TripActivityRow[]> {
  return trx
    .selectFrom("trip_activities")
    .select([...activitySelect, startsAtExpr, endsAtExpr])
    .where("trip_activities.stop_id", "=", stopId)
    .orderBy(sql`lower(trip_activities.slot)`, "asc")
    .execute();
}

export async function findActivityById(
  trx: Tx,
  id: string,
): Promise<TripActivityRow | undefined> {
  return trx
    .selectFrom("trip_activities")
    .select([...activitySelect, startsAtExpr, endsAtExpr])
    .where("trip_activities.id", "=", id)
    // See the note above: the temporal PK does not make id alone unique.
    .orderBy(sql`lower(trip_activities.slot)`, "asc")
    .limit(1)
    .executeTakeFirst();
}

export interface InsertActivityInput {
  stopId: string;
  activityId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  category: CostCategory;
  costAmount: string;
  notes: string | null;
}

/**
 * Two statements, same reason as trips and stops: RETURNING is subject to the
 * SELECT policy, which is a STABLE function that cannot see the row being
 * inserted. See db/uuid.ts.
 */
export async function insertActivity(
  trx: Tx,
  input: InsertActivityInput,
): Promise<TripActivityRow> {
  const id = uuidv7();

  await trx
    .insertInto("trip_activities")
    .values({
      id,
      stop_id: input.stopId,
      activity_id: input.activityId,
      title: input.title,
      slot: toSlot(input.startsAt, input.endsAt),
      category: input.category,
      cost_amount: input.costAmount,
      notes: input.notes,
    })
    .execute();

  const row = await findActivityById(trx, id);
  if (row === undefined) {
    throw new Error(`inserted activity ${id} is not readable by its own transaction`);
  }

  return row;
}

export interface UpdateActivityFields {
  title?: string;
  slot?: string;
  category?: CostCategory;
  costAmount?: string;
  notes?: string | null;
}

export async function updateActivity(
  trx: Tx,
  id: string,
  fields: UpdateActivityFields,
): Promise<TripActivityRow | undefined> {
  const values: Record<string, unknown> = {};
  if (fields.title !== undefined) values["title"] = fields.title;
  if (fields.slot !== undefined) values["slot"] = fields.slot;
  if (fields.category !== undefined) values["category"] = fields.category;
  if (fields.costAmount !== undefined) values["cost_amount"] = fields.costAmount;
  if (fields.notes !== undefined) values["notes"] = fields.notes;

  if (Object.keys(values).length > 0) {
    await trx.updateTable("trip_activities").set(values).where("id", "=", id).execute();
  }

  return findActivityById(trx, id);
}

export async function deleteActivity(trx: Tx, id: string): Promise<number> {
  const result = await trx
    .deleteFrom("trip_activities")
    .where("id", "=", id)
    .executeTakeFirst();

  return Number(result.numDeletedRows);
}

/** Confirms a catalogue activity exists before it is referenced. */
export async function catalogueActivityExists(trx: Tx, id: string): Promise<boolean> {
  const row = await trx
    .selectFrom("activities")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();

  return row !== undefined;
}
