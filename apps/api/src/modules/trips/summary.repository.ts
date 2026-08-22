import type { Selectable } from "kysely";
import type { Tx } from "../../db/plugin.js";
import type { TripCostSummaryView } from "../../db/types.js";

/**
 * SQL only.
 *
 * NOTE THE ABSENCE OF A `WHERE owner_id` CLAUSE. `trip_cost_summary` is
 * declared `security_invoker = true`, so the view executes as the caller and
 * the `trips` policies apply verbatim.
 *
 * Filtering by owner here would be wrong in both directions: it is the leak
 * risk if forgotten, and if remembered it *hides* trips a collaborator
 * legitimately sees. Letting the database answer removes both.
 */

export type TripSummaryRow = Selectable<TripCostSummaryView>;

export interface ListSummariesInput {
  afterId: string | undefined;
  limit: number;
}

export async function listTripSummaries(
  trx: Tx,
  input: ListSummariesInput,
): Promise<TripSummaryRow[]> {
  let query = trx
    .selectFrom("trip_cost_summary")
    .selectAll()
    .orderBy("trip_id", "desc")
    .limit(input.limit + 1);

  if (input.afterId !== undefined) {
    query = query.where("trip_id", "<", input.afterId);
  }

  return query.execute();
}
