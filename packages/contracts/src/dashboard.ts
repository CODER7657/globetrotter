import { z } from "zod";
import { TripId, UserId } from "./ids.js";
import { CurrencyCodeSchema, IsoDateSchema, IsoDateTimeSchema, MoneyAmountSchema } from "./common.js";
import { TripStatusSchema, TripVisibilitySchema } from "./trip.js";
import { UserRoleSchema } from "./auth.js";

/**
 * Dashboard and admin (#66 item 3).
 *
 * Money is a decimal STRING here, unlike the cost breakdown — these come from
 * ordinary numeric columns rather than through jsonb, so no float is involved.
 */

/**
 * One trip card. Reads from the `trip_cost_summary` view, which is
 * `security_invoker = true`, so the caller's RLS applies and the API filters
 * nothing by hand.
 */
export const TripSummarySchema = z.object({
  tripId: TripId,
  ownerId: UserId,
  name: z.string(),
  status: TripStatusSchema,
  visibility: TripVisibilitySchema,
  baseCurrency: CurrencyCodeSchema,
  budgetCap: MoneyAmountSchema.nullable(),
  coverImageUrl: z.string().nullable(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  totalDays: z.number().int(),
  stopCount: z.number().int(),
  activityCount: z.number().int(),
  totalCost: MoneyAmountSchema,
  /** null when no budget is set; negative means over. */
  remaining: MoneyAmountSchema.nullable(),
  overBudget: z.boolean(),
});

export type TripSummary = z.infer<typeof TripSummarySchema>;

// ---------------------------------------------------------------- admin ---

export const CountByDaySchema = z.object({
  day: IsoDateSchema,
  count: z.number().int(),
});

export const TopCitySchema = z.object({
  cityId: z.string().uuid(),
  name: z.string(),
  countryCode: z.string().length(2),
  tripCount: z.number().int(),
});

export const TopActivitySchema = z.object({
  activityId: z.string().uuid(),
  name: z.string(),
  scheduledCount: z.number().int(),
});

export const AdminMetricsSchema = z.object({
  totals: z.object({
    users: z.number().int(),
    trips: z.number().int(),
    stops: z.number().int(),
    activities: z.number().int(),
  }),
  /** Trips created per day over the requested window. */
  tripsOverTime: z.array(CountByDaySchema),
  topCities: z.array(TopCitySchema),
  topActivities: z.array(TopActivitySchema),
  averages: z.object({
    tripLengthDays: z.number().nullable(),
    /** Averaged only over trips that set a budget. */
    budget: MoneyAmountSchema.nullable(),
    stopsPerTrip: z.number().nullable(),
  }),
  engagement: z.object({
    /** Distinct users seen in the last 1 and 7 days. */
    dau: z.number().int(),
    wau: z.number().int(),
  }),
});

export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;

export const AdminMetricsQuerySchema = z.object({
  /** Window for tripsOverTime, in days. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type AdminMetricsQuery = z.infer<typeof AdminMetricsQuerySchema>;

export const AdminUserSchema = z.object({
  id: UserId,
  email: z.string(),
  displayName: z.string(),
  role: UserRoleSchema,
  homeCurrency: CurrencyCodeSchema,
  emailVerifiedAt: IsoDateTimeSchema.nullable(),
  lastLoginAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /** Non-null means suspended. Accounts are never hard-deleted. */
  deletedAt: IsoDateTimeSchema.nullable(),
  tripCount: z.number().int(),
});

export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserQuerySchema = z.object({
  q: z.string().max(120).optional(),
  role: UserRoleSchema.optional(),
  includeSuspended: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  sort: z.enum(["createdAt", "lastLoginAt", "email"]).default("createdAt"),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type AdminUserQuery = z.infer<typeof AdminUserQuerySchema>;
