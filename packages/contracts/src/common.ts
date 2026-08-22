import { z } from "zod";

/** ISO-8601 calendar date, `YYYY-MM-DD`. Maps to Postgres `DATE`. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

/** ISO-8601 instant. Maps to Postgres `TIMESTAMPTZ`. */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * Money is a decimal *string*, never a float — it crosses the wire exactly as
 * Postgres `NUMERIC(12,2)` stores it. Parsing to `number` anywhere in the
 * stack is a bug.
 */
export const MoneyAmountSchema = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,2})?$/, "invalid decimal");

/** ISO-4217, and a FK to `currencies.code` in the database. */
export const CurrencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Za-z]{3}$/, "must be a 3-letter currency code")
  .transform((v) => v.toUpperCase());

/** An amount paired with its currency. */
export const MoneySchema = z.object({
  amount: MoneyAmountSchema,
  currency: CurrencyCodeSchema,
});

export type Money = z.infer<typeof MoneySchema>;

/** Optimistic concurrency token (issue #17: `If-Match` / 409 on mismatch). */
export const VersionSchema = z.number().int().positive();

/**
 * A currency conversion rate: 1 `base` buys `rate` of `quote`.
 *
 * Reference data, seeded from `fx_rates`. Exposed so the client can show a
 * traveller's preferred currency without inventing a rate — the alternative is
 * relabelling EUR amounts as USD, which is worse than showing EUR.
 */
export const FxRateSchema = z.object({
  base: CurrencyCodeSchema,
  quote: CurrencyCodeSchema,
  rate: z.string(),
  asOf: IsoDateSchema,
});

export type FxRate = z.infer<typeof FxRateSchema>;
