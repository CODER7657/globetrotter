import { unsafeId } from "@globetrotter/contracts";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors.js";
import { ErrorCode } from "@globetrotter/contracts";
import { findTripById } from "./trips.repository.js";
import {
  deleteStop,
  findStopById,
  insertStop,
  listStops,
  nextSeq,
  reorderStops,
  stopIdsForTrip,
  toTstzrange,
  updateStop,
} from "./stops.repository.js";
import type { CityId, StopId, TripId, TripStop, UserId } from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";
import type { StopRow, UpdateStopFields } from "./stops.repository.js";
import type { CreateStopBody, UpdateStopBody } from "./trips.schema.js";

/**
 * Stop business rules. The interesting ones are all about ordering and
 * containment; the temporal ones (no two stops at once, activities inside
 * their stop) are enforced by the schema and surface as AppErrors carrying the
 * violated constraint name.
 */

function toStop(row: StopRow): TripStop {
  return {
    id: unsafeId<StopId>(row.id),
    tripId: unsafeId<TripId>(row.trip_id),
    cityId: unsafeId<CityId>(row.city_id),
    seq: row.seq,
    arrivesAt: row.arrives_at.toISOString(),
    departsAt: row.departs_at.toISOString(),
    arrivalMode: row.arrival_mode,
    arrivalCost: row.arrival_cost,
    lodgingCost: row.lodging_cost,
    notes: row.notes,
  };
}

export interface StopsService {
  list(userId: UserId, tripId: TripId): Promise<TripStop[]>;
  create(userId: UserId, tripId: TripId, body: CreateStopBody): Promise<TripStop>;
  update(userId: UserId, stopId: StopId, body: UpdateStopBody): Promise<TripStop>;
  remove(userId: UserId, stopId: StopId): Promise<void>;
  reorder(userId: UserId, tripId: TripId, orderedIds: readonly StopId[]): Promise<TripStop[]>;
}

export function createStopsService(withTx: WithTx): StopsService {
  /** RLS hides trips the caller cannot see, so absence means 404. */
  async function requireTrip(trx: Parameters<Parameters<WithTx>[1]>[0], tripId: string) {
    const trip = await findTripById(trx, tripId);
    if (trip === undefined) throw new NotFoundError("Trip");
    return trip;
  }

  return {
    async list(userId, tripId) {
      const rows = await withTx(userId, async (trx) => {
        await requireTrip(trx, tripId);
        return listStops(trx, tripId);
      });

      return rows.map(toStop);
    },

    async create(userId, tripId, body) {
      const row = await withTx(userId, async (trx) => {
        await requireTrip(trx, tripId);

        return insertStop(trx, {
          tripId,
          cityId: body.cityId,
          // Appended at the end; position is changed by reorder, not create.
          seq: await nextSeq(trx, tripId),
          arrivesAt: body.arrivesAt,
          departsAt: body.departsAt,
          arrivalMode: body.arrivalMode ?? null,
          arrivalCost: body.arrivalCost ?? "0",
          lodgingCost: body.lodgingCost ?? "0",
          notes: body.notes ?? null,
        });
      });

      return toStop(row);
    },

    async update(userId, stopId, body) {
      const row = await withTx(userId, async (trx) => {
        const existing = await findStopById(trx, stopId);
        if (existing === undefined) throw new NotFoundError("Stop");

        const fields: UpdateStopFields = {};
        if (body.cityId !== undefined) fields.cityId = body.cityId;
        if (body.arrivalMode !== undefined) fields.arrivalMode = body.arrivalMode;
        if (body.arrivalCost !== undefined) fields.arrivalCost = body.arrivalCost;
        if (body.lodgingCost !== undefined) fields.lodgingCost = body.lodgingCost;
        if (body.notes !== undefined) fields.notes = body.notes;

        // The range is one column, so moving either edge rewrites both. The
        // unchanged edge comes from the stored row.
        if (body.arrivesAt !== undefined || body.departsAt !== undefined) {
          const arrivesAt = body.arrivesAt ?? existing.arrives_at.toISOString();
          const departsAt = body.departsAt ?? existing.departs_at.toISOString();

          if (arrivesAt >= departsAt) {
            throw new ValidationError(
              [
                {
                  path: "departsAt",
                  code: "invalid_range",
                  message: "departsAt must be after arrivesAt",
                },
              ],
              "Invalid stop dates",
            );
          }

          fields.period = toTstzrange(arrivesAt, departsAt);
        }

        const updated = await updateStop(trx, stopId, fields);
        if (updated === undefined) throw new NotFoundError("Stop");

        return updated;
      });

      return toStop(row);
    },

    async remove(userId, stopId) {
      await withTx(userId, async (trx) => {
        // Scheduled activities go with it, via the BEFORE DELETE trigger that
        // works around PG18 refusing ON DELETE CASCADE on a temporal FK.
        const deleted = await deleteStop(trx, stopId);
        if (deleted === 0) throw new NotFoundError("Stop");
      });
    },

    async reorder(userId, tripId, orderedIds) {
      const rows = await withTx(userId, async (trx) => {
        await requireTrip(trx, tripId);

        const existing = await stopIdsForTrip(trx, tripId);

        // A reorder must be a permutation of the trip's stops. Accepting a
        // subset would silently leave the omitted stops with stale positions,
        // and accepting a foreign id would renumber another trip.
        const existingSet = new Set(existing);
        const requestedSet = new Set(orderedIds);

        const sameSize =
          requestedSet.size === orderedIds.length && requestedSet.size === existingSet.size;
        const sameMembers = sameSize && orderedIds.every((id) => existingSet.has(id));

        if (!sameMembers) {
          throw new ConflictError(
            ErrorCode.VALIDATION_FAILED,
            "stopIds must list every stop in this trip exactly once",
          );
        }

        await reorderStops(trx, tripId, orderedIds);

        // Read back inside the same transaction so the caller sees the
        // committed order rather than trusting the request echo.
        return listStops(trx, tripId);
      });

      return rows.map(toStop);
    },
  };
}
