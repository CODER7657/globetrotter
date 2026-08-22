import { sql } from "kysely";
import type { Tx } from "../../db/plugin.js";

/**
 * SQL only.
 *
 * `app.trip_cost_breakdown` is STABLE and NOT security definer, so it runs
 * under the caller's RLS — a trip the caller cannot read contributes nothing
 * to it. Authorization stays the database's job here as everywhere else.
 */
export async function tripCostBreakdown(trx: Tx, tripId: string): Promise<unknown> {
  const result = await sql<{ breakdown: unknown }>`
    select app.trip_cost_breakdown(${tripId}::uuid) as breakdown
  `.execute(trx);

  return result.rows[0]?.breakdown;
}
