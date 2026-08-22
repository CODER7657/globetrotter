import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asUser,
  buildTestApp,
  closeHarness,
  pickCities,
  registerUser,
  truncateAll,
} from "../../test/harness.js";
import type { FastifyInstance } from "fastify";
import type { TestSession } from "../../test/harness.js";

/**
 * Cost breakdown (#66 item 4).
 *
 * The arithmetic belongs to `app.trip_cost_breakdown` and is asserted in the
 * SQL suite. What matters here is that the API passes it through faithfully,
 * refuses trips the caller cannot see, and that the document still matches the
 * contract @Hem60 builds against.
 */
describe("cost breakdown API", () => {
  let app: FastifyInstance;
  let owner: TestSession;
  let stranger: TestSession;
  let cities: string[];
  let tripId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
    cities = await pickCities(2);
  });

  afterAll(async () => {
    await app.close();
    await closeHarness();
  });

  beforeEach(async () => {
    await truncateAll();
    owner = await registerUser(app);
    stranger = await registerUser(app);

    const trip = await app.inject({
      method: "POST",
      url: "/api/v1/trips",
      headers: asUser(owner.accessToken),
      payload: {
        name: "Iberian loop",
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        baseCurrency: "EUR",
        budgetCap: "2000.00",
      },
    });
    tripId = trip.json<{ data: { id: string } }>().data.id;
  });

  async function addStop(
    cityIndex: number,
    from: string,
    to: string,
    costs: { arrivalCost?: string; lodgingCost?: string } = {},
  ): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/trips/${tripId}/stops`,
      headers: asUser(owner.accessToken),
      payload: { cityId: cities[cityIndex], arrivesAt: from, departsAt: to, ...costs },
    });

    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

  const cost = (user: TestSession, trip = tripId) =>
    app.inject({
      method: "GET",
      url: `/api/v1/trips/${trip}/cost`,
      headers: asUser(user.accessToken),
    });

  it("returns a complete, contract-shaped document for an empty trip", async () => {
    const response = await cost(owner);

    expect(response.statusCode).toBe(200);

    // A parse failure would have surfaced as a 500 from the service, so a 200
    // here means the SQL still matches CostBreakdownSchema. That is the
    // anti-drift check between db/ and packages/contracts.
    const data = response.json<{ data: Record<string, unknown> }>().data;

    expect(data).toMatchObject({
      tripId,
      currency: "EUR",
      total: 0,
      totalDays: 14,
      overBudget: false,
    });
    expect(data["byCategory"]).toEqual(expect.any(Object));
    expect(data["stops"]).toEqual([]);
    expect(data["warnings"]).toEqual([]);
  });

  it("totals stop costs the database computed", async () => {
    await addStop(0, "2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z", {
      arrivalCost: "150.00",
      lodgingCost: "400.00",
    });

    const data = cost(owner).then((r) =>
      r.json<{ data: { total: number; stops: { transport: number; stay: number }[] } }>().data,
    );

    const breakdown = await data;
    expect(breakdown.total).toBe(550);
    expect(breakdown.stops).toHaveLength(1);
    expect(breakdown.stops[0]).toMatchObject({ transport: 150, stay: 400 });
  });

  it("reports remaining budget and flags going over it", async () => {
    await addStop(0, "2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z", {
      arrivalCost: "1500.00",
      lodgingCost: "900.00",
    });

    const data = (
      await cost(owner)
    ).json<{ data: { total: number; budgetCap: number; remaining: number; overBudget: boolean } }>()
      .data;

    expect(data.total).toBe(2400);
    expect(data.budgetCap).toBe(2000);
    // Negative remaining rather than clamped at zero — the panel shows by how
    // much.
    expect(data.remaining).toBe(-400);
    expect(data.overBudget).toBe(true);
  });

  it("includes scheduled activity costs", async () => {
    const stopId = await addStop(0, "2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z");

    const scheduled = await app.inject({
      method: "POST",
      url: `/api/v1/stops/${stopId}/activities`,
      headers: asUser(owner.accessToken),
      payload: {
        title: "Alfama walking tour",
        startsAt: "2026-09-02T10:00:00Z",
        endsAt: "2026-09-02T13:00:00Z",
        costAmount: "75.50",
        category: "activity",
      },
    });
    expect(scheduled.statusCode).toBe(201);

    const data = (
      await cost(owner)
    ).json<{ data: { total: number; byCategory: Record<string, number> } }>().data;

    expect(data.total).toBe(75.5);
    expect(data.byCategory["activity"]).toBe(75.5);
  });

  it("hides another user's trip behind a 404", async () => {
    const response = await cost(stranger);

    // app.trip_cost_breakdown is STABLE and not SECURITY DEFINER, so it runs
    // under the caller's RLS — but it would return a null-filled document
    // rather than erroring, which is why the service checks readability first.
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe("NOT_FOUND");
  });

  it("requires authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}/cost`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("never lets a shared cache hold one user's spending", async () => {
    const response = await cost(owner);

    const cacheControl = String(response.headers["cache-control"]);
    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
    expect(response.headers["etag"]).toEqual(expect.any(String));
  });

  it("answers an unchanged re-fetch with 304", async () => {
    const first = await cost(owner);
    const etag = String(first.headers["etag"]);

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}/cost`,
      headers: { ...asUser(owner.accessToken), "if-none-match": etag },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("changes the ETag once the itinerary changes", async () => {
    const before = String((await cost(owner)).headers["etag"]);

    await addStop(0, "2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z", {
      arrivalCost: "10.00",
    });

    const after = String((await cost(owner)).headers["etag"]);

    // trips.version does not move when a stop is added, so an ETag derived
    // from it would have gone stale here. Content-derived is what makes this
    // correct.
    expect(after).not.toBe(before);
  });
});
