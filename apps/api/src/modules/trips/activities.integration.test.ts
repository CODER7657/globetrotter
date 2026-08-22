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
 * Scheduled activities. The two tests worth reading are the double-book and
 * the containment one — between them they demonstrate that an impossible
 * itinerary has no representation in the schema, which is the core claim of
 * the project (#41).
 */
describe("trip activities API", () => {
  let app: FastifyInstance;
  let owner: TestSession;
  let stranger: TestSession;
  let cities: string[];
  let stopId: string;

  // The stop runs 1 Sep 09:00 -> 5 Sep 18:00. Everything below is relative.
  const STOP_FROM = "2026-09-01T09:00:00Z";
  const STOP_TO = "2026-09-05T18:00:00Z";

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
        endDate: "2026-09-30",
        baseCurrency: "EUR",
      },
    });
    const tripId = trip.json<{ data: { id: string } }>().data.id;

    const stop = await app.inject({
      method: "POST",
      url: `/api/v1/trips/${tripId}/stops`,
      headers: asUser(owner.accessToken),
      payload: { cityId: cities[0], arrivesAt: STOP_FROM, departsAt: STOP_TO },
    });
    stopId = stop.json<{ data: { id: string } }>().data.id;
  });

  const schedule = (
    user: TestSession,
    payload: Record<string, unknown>,
    stop: string = stopId,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/stops/${stop}/activities`,
      headers: asUser(user.accessToken),
      payload,
    });

  const activity = (title: string, from: string, to: string) => ({
    title,
    startsAt: from,
    endsAt: to,
  });

  describe("scheduling", () => {
    it("schedules an activity inside its stop", async () => {
      const response = await schedule(
        owner,
        activity("Alfama walking tour", "2026-09-02T10:00:00Z", "2026-09-02T13:00:00Z"),
      );

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: Record<string, unknown> }>().data).toMatchObject({
        title: "Alfama walking tour",
        stopId,
        category: "activity",
        costAmount: "0.00",
        activityId: null,
      });
    });

    it("refuses to double-book a slot, and names the constraint", async () => {
      await schedule(
        owner,
        activity("Alfama walking tour", "2026-09-02T10:00:00Z", "2026-09-02T13:00:00Z"),
      );

      const clash = await schedule(
        owner,
        activity("Tram 28", "2026-09-02T12:00:00Z", "2026-09-02T14:00:00Z"),
      );

      expect(clash.statusCode).toBe(409);

      const problem = clash.json<{ code: string; constraint: string }>();
      expect(problem.code).toBe("OVERLAP");
      expect(problem.constraint).toBe("trip_activities_no_double_book");
    });

    it("allows back-to-back activities, because the range is half-open", async () => {
      await schedule(
        owner,
        activity("Morning tour", "2026-09-02T10:00:00Z", "2026-09-02T12:00:00Z"),
      );

      // Starts exactly when the previous one ends. `[)` means no overlap.
      const adjacent = await schedule(
        owner,
        activity("Lunch", "2026-09-02T12:00:00Z", "2026-09-02T13:00:00Z"),
      );

      expect(adjacent.statusCode).toBe(201);
    });

    it("refuses an activity that falls outside its stop — the temporal FK", async () => {
      // The stop ends on 5 Sep; this is the 7th.
      const outside = await schedule(
        owner,
        activity("Ghost tour", "2026-09-07T10:00:00Z", "2026-09-07T12:00:00Z"),
      );

      expect(outside.statusCode).toBe(422);

      const problem = outside.json<{ code: string; constraint: string }>();
      // Arrives as SQLSTATE 23503 rather than 23P01: this is a referential
      // constraint over time, not an exclusion constraint.
      expect(problem.constraint).toBe("trip_activities_within_stop");
      expect(problem.code).toBe("VALIDATION_FAILED");
    });

    it("refuses an activity that only partially overlaps the stop", async () => {
      // Starts inside the stop but runs past its end.
      const straddling = await schedule(
        owner,
        activity("Farewell dinner", "2026-09-05T16:00:00Z", "2026-09-05T23:00:00Z"),
      );

      expect(straddling.statusCode).toBe(422);
      expect(straddling.json<{ constraint: string }>().constraint).toBe(
        "trip_activities_within_stop",
      );
    });

    it("rejects a slot longer than 24 hours before the database has to", async () => {
      const tooLong = await schedule(
        owner,
        activity("Endless tour", "2026-09-02T10:00:00Z", "2026-09-04T10:00:00Z"),
      );

      expect(tooLong.statusCode).toBe(422);
      expect(
        tooLong.json<{ errors: { path: string }[] }>().errors.map((e) => e.path),
      ).toContain("endsAt");
    });

    it("rejects an unknown catalogue activity distinguishably", async () => {
      const response = await schedule(owner, {
        ...activity("Mystery", "2026-09-02T10:00:00Z", "2026-09-02T11:00:00Z"),
        activityId: "01936c1a-7b3f-7a2e-8f4d-1c2b3a4d5e6f",
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ code: string }>().code).toBe("FK_VIOLATION");
    });

    it("hides another user's stop behind a 404", async () => {
      const response = await schedule(
        stranger,
        activity("Trespass", "2026-09-02T10:00:00Z", "2026-09-02T11:00:00Z"),
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe("listing, updating and deleting", () => {
    async function scheduleOne(): Promise<string> {
      const response = await schedule(
        owner,
        activity("Alfama walking tour", "2026-09-02T10:00:00Z", "2026-09-02T13:00:00Z"),
      );

      expect(response.statusCode).toBe(201);
      return response.json<{ data: { id: string } }>().data.id;
    }

    it("lists activities earliest first", async () => {
      await schedule(owner, activity("Later", "2026-09-02T15:00:00Z", "2026-09-02T16:00:00Z"));
      await schedule(owner, activity("Earlier", "2026-09-02T09:00:00Z", "2026-09-02T10:00:00Z"));

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/stops/${stopId}/activities`,
        headers: asUser(owner.accessToken),
      });

      expect(response.json<{ data: { title: string }[] }>().data.map((a) => a.title)).toEqual([
        "Earlier",
        "Later",
      ]);
    });

    it("moves only the edge named in the patch", async () => {
      const id = await scheduleOne();

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/trip-activities/${id}`,
        headers: asUser(owner.accessToken),
        payload: { endsAt: "2026-09-02T15:00:00Z" },
      });

      expect(response.statusCode).toBe(200);

      const updated = response.json<{ data: { startsAt: string; endsAt: string } }>().data;
      expect(updated.endsAt).toBe("2026-09-02T15:00:00.000Z");
      expect(updated.startsAt).toBe("2026-09-02T10:00:00.000Z");
    });

    it("refuses a patch that would push the activity outside its stop", async () => {
      const id = await scheduleOne();

      // Both edges move together to a short window before the stop begins.
      // Moving only one edge would span days and be caught by the 24h rule
      // first, which would test the wrong thing.
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/trip-activities/${id}`,
        headers: asUser(owner.accessToken),
        payload: {
          startsAt: "2026-08-31T10:00:00Z",
          endsAt: "2026-08-31T12:00:00Z",
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ constraint: string }>().constraint).toBe(
        "trip_activities_within_stop",
      );
    });

    it("updates cost without touching the schedule", async () => {
      const id = await scheduleOne();

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/trip-activities/${id}`,
        headers: asUser(owner.accessToken),
        payload: { costAmount: "42.50", category: "meal" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: Record<string, unknown> }>().data).toMatchObject({
        costAmount: "42.50",
        category: "meal",
        startsAt: "2026-09-02T10:00:00.000Z",
      });
    });

    it("deletes an activity", async () => {
      const id = await scheduleOne();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/trip-activities/${id}`,
        headers: asUser(owner.accessToken),
      });

      expect(response.statusCode).toBe(204);
    });

    it("will not let a stranger delete one", async () => {
      const id = await scheduleOne();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/trip-activities/${id}`,
        headers: asUser(stranger.accessToken),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("deleting the parent stop", () => {
    it("takes its activities with it", async () => {
      await schedule(
        owner,
        activity("Alfama walking tour", "2026-09-02T10:00:00Z", "2026-09-02T13:00:00Z"),
      );

      // PG18 rejects ON DELETE CASCADE on a temporal FK, so 004_trips works
      // around it with a BEFORE DELETE trigger. Without that, this 204 would
      // be a constraint violation instead.
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/stops/${stopId}`,
        headers: asUser(owner.accessToken),
      });

      expect(response.statusCode).toBe(204);

      const orphans = await app.inject({
        method: "GET",
        url: `/api/v1/stops/${stopId}/activities`,
        headers: asUser(owner.accessToken),
      });

      expect(orphans.statusCode).toBe(404);
    });
  });
});
