import { z } from "zod";
import { TripId } from "./ids.js";
import { CurrencyCodeSchema } from "./common.js";

/**
 * Cost breakdown (#66 item 4) — the entire Budget screen in one call.
 *
 * This mirrors `app.trip_cost_breakdown(uuid)` verbatim. The database does
 * every calculation; the API is a pass-through and adds nothing.
 *
 * ⚠️ MONEY IS A NUMBER HERE, not the decimal string used everywhere else in
 * these contracts. That is not a choice — `jsonb_build_object` emits numeric
 * as a JSON number, and a JSON number becomes a JS float on parse. It is
 * accurate to 2dp for any realistic trip budget, but it means **the client
 * must not do arithmetic on these values**: summing `byCategory` in JS can
 * disagree with `total`, which the database computed in exact numeric.
 *
 * Every figure you need is already computed server-side for this reason.
 */

const Money = z.number();

export const CostWarningSchema = z.object({
  seq: z.number().int(),
  from: z.string(),
  to: z.string(),
  /** Minutes between leaving one city and arriving at the next. */
  gapMinutes: z.number(),
});

export const CostPerDaySchema = z.object({
  day: z.string(),
  amount: Money,
});

export const CostCumulativeSchema = z.object({
  seq: z.number().int(),
  city: z.string(),
  runningTotal: Money,
});

export const CostStopSchema = z.object({
  seq: z.number().int(),
  city: z.string(),
  country: z.string(),
  nights: z.number().int(),
  transport: Money,
  stay: Money,
});

export const CostBreakdownSchema = z.object({
  tripId: TripId,
  currency: CurrencyCodeSchema,
  totalDays: z.number().int(),
  total: Money,
  budgetCap: Money.nullable(),
  /** null when no budget was set. Negative means over. */
  remaining: Money.nullable(),
  overBudget: z.boolean(),
  perDayAverage: Money.nullable(),
  /** Keyed by cost_category: transport, stay, activity, meal, other. */
  byCategory: z.record(z.string(), Money),
  perDay: z.array(CostPerDaySchema),
  cumulative: z.array(CostCumulativeSchema),
  stops: z.array(CostStopSchema),
  /** Impossible-looking transfers, e.g. a 20-minute hop between countries. */
  warnings: z.array(CostWarningSchema),
});

export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;
export type CostWarning = z.infer<typeof CostWarningSchema>;
