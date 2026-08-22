import { describe, expect, it } from "vitest";
import { CreateTripBodySchema, MoneySchema, TripId, UserId } from "./index.js";

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

describe("MoneySchema", () => {
  it("keeps the amount as an exact decimal string", () => {
    const parsed = MoneySchema.parse({ amount: "1234.50", currency: "eur" });
    expect(parsed.amount).toBe("1234.50");
    // Currency is normalised so the client cannot send a case the DB rejects.
    expect(parsed.currency).toBe("EUR");
  });

  it("rejects more than two decimal places", () => {
    expect(MoneySchema.safeParse({ amount: "1.005", currency: "EUR" }).success).toBe(false);
  });

  it("rejects a float, which is the whole point", () => {
    expect(MoneySchema.safeParse({ amount: 1234.5, currency: "EUR" }).success).toBe(false);
  });
});

describe("CreateTripBodySchema", () => {
  const base = { title: "Iberian loop", startDate: "2026-09-01", endDate: "2026-09-14" };

  it("accepts a well-formed trip", () => {
    expect(CreateTripBodySchema.safeParse(base).success).toBe(true);
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

  it("rejects a date that is not YYYY-MM-DD", () => {
    expect(CreateTripBodySchema.safeParse({ ...base, startDate: "01/09/2026" }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(CreateTripBodySchema.safeParse({ ...base, title: "" }).success).toBe(false);
  });
});
