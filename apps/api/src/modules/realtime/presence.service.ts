import { unsafeId } from "@globetrotter/contracts";
import { NotFoundError } from "../../core/errors.js";
import { findTripById } from "../trips/trips.repository.js";
import { listPresence } from "./presence.repository.js";
import type { TripId, TripPresence, UserId } from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";

/**
 * Presence reads.
 *
 * Kept to the same 90-second window the WebSocket layer uses for its reaper.
 * If these disagreed, the avatar bar would show someone the socket had already
 * dropped, or hide someone it still considered live.
 */
export const PRESENCE_STALE_AFTER_SECONDS = 90;

export interface PresenceService {
  forTrip(userId: UserId, tripId: TripId): Promise<TripPresence>;
}

export function createPresenceService(withTx: WithTx): PresenceService {
  return {
    async forTrip(userId, tripId) {
      const rows = await withTx(userId, async (trx) => {
        // Distinguishes "nobody is here" from "you cannot see this trip".
        // Without it both would be an empty list, and a client could not tell
        // a quiet trip from one it has lost access to.
        const trip = await findTripById(trx, tripId);
        if (trip === undefined) throw new NotFoundError("Trip");

        return listPresence(trx, tripId, PRESENCE_STALE_AFTER_SECONDS);
      });

      return {
        viewers: rows.map((row) => ({
          userId: unsafeId<UserId>(row.user_id),
          connections: row.connections,
          lastSeen: row.last_seen.toISOString(),
        })),
        staleAfterSeconds: PRESENCE_STALE_AFTER_SECONDS,
      };
    },
  };
}
