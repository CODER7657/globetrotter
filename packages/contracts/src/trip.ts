import { z } from "zod";
import { CityId, StopId, TripActivityId, TripId, UserId, ActivityId } from "./ids.js";
import {
  CurrencyCodeSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MoneyAmountSchema,
  VersionSchema,
} from "./common.js";

/**
 * Trip contracts, mirroring db/migrations/004_trips.up.sql.
 *
 * DATE SEMANTICS — the one thing to get right here.
 * The database stores `period` as a half-open `[)` daterange. This API speaks
 * *inclusive* dates, because "my trip ends on the 14th" is what a person
 * means. The service converts: endDate 2026-09-14 is stored as an exclusive
 * upper bound of 2026-09-15 and read back as 14 again. Clients never see the
 * exclusive form.
 */

export const TripStatusSchema = z.enum([
  "draft",
  "planned",
  "active",
  "completed",
  "archived",
]);
export type TripStatus = z.infer<typeof TripStatusSchema>;

export const TripVisibilitySchema = z.enum(["private", "unlisted", "public"]);
export type TripVisibility = z.infer<typeof TripVisibilitySchema>;

export const TripSchema = z.object({
  id: TripId,
  ownerId: UserId,
  name: z.string().min(1).max(120),
  description: z.string().max(4000).nullable(),
  /** Inclusive. See the note above. */
  startDate: IsoDateSchema,
  /** Inclusive. See the note above. */
  endDate: IsoDateSchema,
  status: TripStatusSchema,
  visibility: TripVisibilitySchema,
  baseCurrency: CurrencyCodeSchema,
  budgetCap: MoneyAmountSchema.nullable(),
  coverImageUrl: z.string().url().nullable(),
  version: VersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type Trip = z.infer<typeof TripSchema>;

/** `trips_period_sane` caps a trip at 366 days; rejected here too, with a
 *  message a form can show instead of a database error. */
const MAX_TRIP_DAYS = 366;

export const CreateTripBodySchema = z
  .object({
    name: z.string().min(1).max(120).trim(),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    baseCurrency: CurrencyCodeSchema,
    description: z.string().max(4000).nullish(),
    coverImageUrl: z.string().url().nullish(),
    budgetCap: MoneyAmountSchema.nullish(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "endDate must not precede startDate",
    path: ["endDate"],
  })
  .refine(
    (v) => {
      const days =
        (Date.parse(`${v.endDate}T00:00:00Z`) - Date.parse(`${v.startDate}T00:00:00Z`)) /
          86_400_000 +
        1;
      return days <= MAX_TRIP_DAYS;
    },
    { message: `A trip cannot be longer than ${MAX_TRIP_DAYS} days`, path: ["endDate"] },
  );

export type CreateTripBody = z.infer<typeof CreateTripBodySchema>;

/** JSON Merge Patch: every field optional, `null` means clear. */
export const UpdateTripBodySchema = z
  .object({
    name: z.string().min(1).max(120).trim(),
    description: z.string().max(4000).nullable(),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    status: TripStatusSchema,
    visibility: TripVisibilitySchema,
    budgetCap: MoneyAmountSchema.nullable(),
    coverImageUrl: z.string().url().nullable(),
  })
  .partial();

export type UpdateTripBody = z.infer<typeof UpdateTripBodySchema>;

/**
 * A stop's `period` is a tstzrange, so arrival and departure are instants, not
 * dates — a stop can begin at 14:00 and end at 09:00 four days later.
 */
export const TripStopSchema = z.object({
  id: StopId,
  tripId: TripId,
  cityId: CityId,
  /** 1-based ordering within the trip. Reordered transactionally. */
  seq: z.number().int().positive(),
  arrivesAt: IsoDateTimeSchema,
  departsAt: IsoDateTimeSchema,
  arrivalMode: z
    .enum(["flight", "train", "bus", "car", "ferry", "walk", "other"])
    .nullable(),
  arrivalCost: MoneyAmountSchema,
  lodgingCost: MoneyAmountSchema,
  notes: z.string().max(2000).nullable(),
});

export type TripStop = z.infer<typeof TripStopSchema>;

export const CreateStopBodySchema = TripStopSchema.pick({
  cityId: true,
  arrivesAt: true,
  departsAt: true,
})
  .extend({
    arrivalMode: TripStopSchema.shape.arrivalMode.nullish(),
    arrivalCost: MoneyAmountSchema.nullish(),
    lodgingCost: MoneyAmountSchema.nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .refine((v) => v.arrivesAt < v.departsAt, {
    message: "departsAt must be after arrivesAt",
    path: ["departsAt"],
  });

export type CreateStopBody = z.infer<typeof CreateStopBodySchema>;

/** JSON Merge Patch for a stop. Every field optional; null clears. */
export const UpdateStopBodySchema = z
  .object({
    cityId: CityId,
    arrivesAt: IsoDateTimeSchema,
    departsAt: IsoDateTimeSchema,
    arrivalMode: TripStopSchema.shape.arrivalMode,
    arrivalCost: MoneyAmountSchema,
    lodgingCost: MoneyAmountSchema,
    notes: z.string().max(2000).nullable(),
  })
  .partial();

export type UpdateStopBody = z.infer<typeof UpdateStopBodySchema>;

/** Whole-list reorder, applied in one transaction (issue #17). */
export const ReorderStopsBodySchema = z.object({
  stopIds: z.array(StopId).min(1),
});

export type ReorderStopsBody = z.infer<typeof ReorderStopsBodySchema>;

export const CostCategorySchema = z.enum([
  "transport",
  "stay",
  "activity",
  "meal",
  "other",
]);
export type CostCategory = z.infer<typeof CostCategorySchema>;

export const TripActivitySchema = z.object({
  id: TripActivityId,
  stopId: StopId,
  /** Null when the activity is freeform rather than from the catalog. */
  activityId: ActivityId.nullable(),
  title: z.string().min(1).max(160),
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  category: CostCategorySchema,
  costAmount: MoneyAmountSchema,
  notes: z.string().max(2000).nullable(),
});

export type TripActivity = z.infer<typeof TripActivitySchema>;

export const CreateTripActivityBodySchema = TripActivitySchema.pick({
  title: true,
  startsAt: true,
  endsAt: true,
})
  .extend({
    activityId: ActivityId.nullish(),
    category: CostCategorySchema.optional(),
    costAmount: MoneyAmountSchema.nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .refine((v) => v.startsAt < v.endsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

export type CreateTripActivityBody = z.infer<typeof CreateTripActivityBodySchema>;

/** JSON Merge Patch for a scheduled activity. */
export const UpdateTripActivityBodySchema = z
  .object({
    title: z.string().min(1).max(160),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    category: CostCategorySchema,
    costAmount: MoneyAmountSchema,
    notes: z.string().max(2000).nullable(),
  })
  .partial();

export type UpdateTripActivityBody = z.infer<typeof UpdateTripActivityBodySchema>;
