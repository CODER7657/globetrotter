import { CostBreakdownSchema } from "@globetrotter/contracts";
import { InternalError, NotFoundError } from "../../core/errors.js";
import { findTripById } from "./trips.repository.js";
import { tripCostBreakdown } from "./cost.repository.js";
import type { CostBreakdown, TripId, UserId } from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";

/**
 * Cost breakdown (#66 item 4).
 *
 * Deliberately thin: the database computes every figure, and duplicating any
 * of that arithmetic here would create a second answer that can disagree with
 * the first.
 */
export interface CostService {
  breakdown(userId: UserId, tripId: TripId): Promise<CostBreakdown>;
}

export function createCostService(withTx: WithTx): CostService {
  return {
    async breakdown(userId, tripId) {
      const raw = await withTx(userId, async (trx) => {
        // The function runs under RLS, so an unreadable trip yields a document
        // full of nulls rather than an error. Checking readability first turns
        // that into an honest 404.
        const trip = await findTripById(trx, tripId);
        if (trip === undefined) throw new NotFoundError("Trip");

        return tripCostBreakdown(trx, tripId);
      });

      // Validated rather than cast. This is the seam where a change to the SQL
      // would otherwise reach @Hem60's budget panel as a runtime surprise; a
      // parse failure here names the field instead.
      const parsed = CostBreakdownSchema.safeParse(raw);
      if (!parsed.success) {
        throw new InternalError(
          `app.trip_cost_breakdown returned an unexpected shape: ${parsed.error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; ")}`,
        );
      }

      return parsed.data;
    },
  };
}
