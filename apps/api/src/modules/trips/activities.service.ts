import { ErrorCode, unsafeId } from "@globetrotter/contracts";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors.js";
import { findStopById } from "./stops.repository.js";
import {
  catalogueActivityExists,
  deleteActivity,
  findActivityById,
  insertActivity,
  listActivitiesForStop,
  toSlot,
  updateActivity,
} from "./activities.repository.js";
import type {
  ActivityId,
  StopId,
  TripActivity,
  TripActivityId,
  UserId,
} from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";
import type { TripActivityRow, UpdateActivityFields } from "./activities.repository.js";
import type { CreateTripActivityBody, UpdateTripActivityBody } from "./trips.schema.js";

/**
 * Scheduled-activity rules.
 *
 * Almost nothing here is a validity check, and that is the point: "this
 * activity is inside its stop" and "nothing else is booked then" are enforced
 * by `trip_activities_within_stop` and `trip_activities_no_double_book`. The
 * service's job is to hand the client back a violation it can act on, not to
 * re-implement the guarantee in TypeScript where it could drift.
 */

function toActivity(row: TripActivityRow): TripActivity {
  return {
    id: unsafeId<TripActivityId>(row.id),
    stopId: unsafeId<StopId>(row.stop_id),
    activityId: row.activity_id === null ? null : unsafeId<ActivityId>(row.activity_id),
    title: row.title,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    category: row.category,
    costAmount: row.cost_amount,
    notes: row.notes,
  };
}

/** `trip_activities_slot_sane` caps a single activity at 24 hours. */
const MAX_SLOT_HOURS = 24;

function assertSlotSane(startsAt: string, endsAt: string): void {
  if (startsAt >= endsAt) {
    throw new ValidationError(
      [{ path: "endsAt", code: "invalid_range", message: "endsAt must be after startsAt" }],
      "Invalid activity times",
    );
  }

  const hours = (Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000;
  if (hours > MAX_SLOT_HOURS) {
    throw new ValidationError(
      [
        {
          path: "endsAt",
          code: "slot_too_long",
          message: `An activity cannot run longer than ${MAX_SLOT_HOURS} hours`,
        },
      ],
      "Invalid activity times",
    );
  }
}

export interface ActivitiesService {
  list(userId: UserId, stopId: StopId): Promise<TripActivity[]>;
  create(
    userId: UserId,
    stopId: StopId,
    body: CreateTripActivityBody,
  ): Promise<TripActivity>;
  update(
    userId: UserId,
    id: TripActivityId,
    body: UpdateTripActivityBody,
  ): Promise<TripActivity>;
  remove(userId: UserId, id: TripActivityId): Promise<void>;
}

export function createActivitiesService(withTx: WithTx): ActivitiesService {
  return {
    async list(userId, stopId) {
      const rows = await withTx(userId, async (trx) => {
        // RLS hides stops on trips the caller cannot read, so absence is 404.
        const stop = await findStopById(trx, stopId);
        if (stop === undefined) throw new NotFoundError("Stop");

        return listActivitiesForStop(trx, stopId);
      });

      return rows.map(toActivity);
    },

    async create(userId, stopId, body) {
      assertSlotSane(body.startsAt, body.endsAt);

      const row = await withTx(userId, async (trx) => {
        const stop = await findStopById(trx, stopId);
        if (stop === undefined) throw new NotFoundError("Stop");

        // Checked explicitly because the catalogue FK is ON DELETE SET NULL:
        // a bad id would otherwise surface as a generic FK violation that the
        // client cannot distinguish from the temporal one.
        if (body.activityId !== undefined && body.activityId !== null) {
          const exists = await catalogueActivityExists(trx, body.activityId);
          if (!exists) {
            throw new ConflictError(
              ErrorCode.FK_VIOLATION,
              "No such activity in the catalogue",
            );
          }
        }

        return insertActivity(trx, {
          stopId,
          activityId: body.activityId ?? null,
          title: body.title,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          category: body.category ?? "activity",
          costAmount: body.costAmount ?? "0",
          notes: body.notes ?? null,
        });
      });

      return toActivity(row);
    },

    async update(userId, id, body) {
      const row = await withTx(userId, async (trx) => {
        const existing = await findActivityById(trx, id);
        if (existing === undefined) throw new NotFoundError("Activity");

        const fields: UpdateActivityFields = {};
        if (body.title !== undefined) fields.title = body.title;
        if (body.category !== undefined) fields.category = body.category;
        if (body.costAmount !== undefined) fields.costAmount = body.costAmount;
        if (body.notes !== undefined) fields.notes = body.notes;

        // Both bounds live in one column, so moving either rewrites the range;
        // the edge that was not named comes from the stored row.
        if (body.startsAt !== undefined || body.endsAt !== undefined) {
          const startsAt = body.startsAt ?? existing.starts_at.toISOString();
          const endsAt = body.endsAt ?? existing.ends_at.toISOString();

          assertSlotSane(startsAt, endsAt);
          fields.slot = toSlot(startsAt, endsAt);
        }

        const updated = await updateActivity(trx, id, fields);
        if (updated === undefined) throw new NotFoundError("Activity");

        return updated;
      });

      return toActivity(row);
    },

    async remove(userId, id) {
      await withTx(userId, async (trx) => {
        const deleted = await deleteActivity(trx, id);
        if (deleted === 0) throw new NotFoundError("Activity");
      });
    },
  };
}
