import { z } from "zod";
import { CityId, StopId, TripActivityId, TripId, UserId, ActivityId } from "./ids.js";
import { IsoDateSchema, IsoDateTimeSchema, MoneySchema, VersionSchema } from "./common.js";

/** private -> unlisted -> public (issue #20's visibility state machine). */
export const TripVisibilitySchema = z.enum(["private", "unlisted", "public"]);
export type TripVisibility = z.infer<typeof TripVisibilitySchema>;

export const TripSchema = z.object({
  id: TripId,
  ownerId: UserId,
  title: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  coverImageUrl: z.string().url().nullable(),
  visibility: TripVisibilitySchema,
  version: VersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type Trip = z.infer<typeof TripSchema>;

const dateOrder = (v: { startDate: string; endDate: string }) =>
  v.startDate <= v.endDate;

export const CreateTripBodySchema = TripSchema.pick({
  title: true,
  startDate: true,
  endDate: true,
})
  .extend({
    description: z.string().max(2000).nullish(),
    coverImageUrl: z.string().url().nullish(),
  })
  .refine(dateOrder, { message: "endDate must not precede startDate", path: ["endDate"] });

export type CreateTripBody = z.infer<typeof CreateTripBodySchema>;

/** JSON Merge Patch: every field optional, `null` means clear. */
export const UpdateTripBodySchema = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(2000).nullable(),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    coverImageUrl: z.string().url().nullable(),
    visibility: TripVisibilitySchema,
  })
  .partial();

export type UpdateTripBody = z.infer<typeof UpdateTripBodySchema>;

export const TripStopSchema = z.object({
  id: StopId,
  tripId: TripId,
  cityId: CityId,
  /** Dense 0-based ordering within the trip; reordered transactionally. */
  position: z.number().int().nonnegative(),
  arrivalDate: IsoDateSchema,
  departureDate: IsoDateSchema,
  notes: z.string().max(2000).nullable(),
});

export type TripStop = z.infer<typeof TripStopSchema>;

export const CreateStopBodySchema = TripStopSchema.pick({
  cityId: true,
  arrivalDate: true,
  departureDate: true,
})
  .extend({ notes: z.string().max(2000).nullish() })
  .refine((v) => v.arrivalDate <= v.departureDate, {
    message: "departureDate must not precede arrivalDate",
    path: ["departureDate"],
  });

export type CreateStopBody = z.infer<typeof CreateStopBodySchema>;

/** Whole-list reorder, applied in one statement (issue #17). */
export const ReorderStopsBodySchema = z.object({
  stopIds: z.array(StopId).min(1),
});

export type ReorderStopsBody = z.infer<typeof ReorderStopsBodySchema>;

export const TripActivitySchema = z.object({
  id: TripActivityId,
  stopId: StopId,
  activityId: ActivityId,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  cost: MoneySchema.nullable(),
  notes: z.string().max(2000).nullable(),
});

export type TripActivity = z.infer<typeof TripActivitySchema>;

export const CreateTripActivityBodySchema = TripActivitySchema.pick({
  activityId: true,
  startsAt: true,
  endsAt: true,
})
  .extend({
    cost: MoneySchema.nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .refine((v) => v.startsAt < v.endsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

export type CreateTripActivityBody = z.infer<typeof CreateTripActivityBodySchema>;
