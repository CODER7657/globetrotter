import { describe, expect, it } from "vitest";
import {
  CreateTripBodySchema,
  CurrencyCodeSchema,
  MoneySchema,
  TripId,
  UserId,
} from "./index.js";

describe("branded ids", () => {
  it("accepts a UUIDv7", () => {
    // uuidv7: version nibble 7, variant nibble 8-b.
    const id = "01936c1a-7b3f-7a2e-8f4d-1c2b3a4d5e6f";
    expect(TripId.parse(id)).toBe(id);
    expect(UserId.parse(id)).toBe(id);
  });

  it("rejects a non-UUID", () => {
    expect(TripId.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("money", () => {
  it("keeps the amount as an exact decimal string", () => {
    const parsed = MoneySchema.parse({ amount: "1234.50", currency: "eur" });
    expect(parsed.amount).toBe("1234.50");
    // Normalised so the client cannot send a case the currencies FK rejects.
    expect(parsed.currency).toBe("EUR");
  });

  it("rejects more than two decimal places", () => {
    expect(MoneySchema.safeParse({ amount: "1.005", currency: "EUR" }).success).toBe(false);
  });

  it("rejects a float, which is the whole point", () => {
    expect(MoneySchema.safeParse({ amount: 1234.5, currency: "EUR" }).success).toBe(false);
  });

  it("rejects a currency code that is not three letters", () => {
    expect(CurrencyCodeSchema.safeParse("EURO").success).toBe(false);
    expect(CurrencyCodeSchema.safeParse("E1R").success).toBe(false);
  });
});

describe("CreateTripBodySchema", () => {
  const base = {
    name: "Iberian loop",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    baseCurrency: "EUR",
  };

  it("accepts a well-formed trip", () => {
    expect(CreateTripBodySchema.safeParse(base).success).toBe(true);
  });

  it("accepts a single-day trip", () => {
    const result = CreateTripBodySchema.safeParse({
      ...base,
      startDate: "2026-09-01",
      endDate: "2026-09-01",
    });

    expect(result.success).toBe(true);
  });

  it("reports the date-order failure on endDate so a form can bind it", () => {
    const result = CreateTripBodySchema.safeParse({
      ...base,
      startDate: "2026-09-20",
      endDate: "2026-09-01",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["endDate"]);
  });

  it("rejects a trip longer than the schema allows, before the database does", () => {
    // trips_period_sane caps a trip at 366 days. Catching it here means the
    // user gets a sentence rather than a constraint violation.
    const result = CreateTripBodySchema.safeParse({
      ...base,
      startDate: "2026-01-01",
      endDate: "2027-06-01",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["endDate"]);
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    expect(CreateTripBodySchema.safeParse({ ...base, startDate: "01/09/2026" }).success).toBe(
      false,
    );
  });

  it("rejects an empty name", () => {
    expect(CreateTripBodySchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("requires a base currency", () => {
    const withoutCurrency: Record<string, unknown> = { ...base };
    delete withoutCurrency["baseCurrency"];

    expect(CreateTripBodySchema.safeParse(withoutCurrency).success).toBe(false);
  });
});
