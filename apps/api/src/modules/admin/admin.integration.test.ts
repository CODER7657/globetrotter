import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminQuery,
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
 * Dashboard summary and admin analytics (#66 item 3).
 *
 * The property under test throughout is that the API filters nothing by hand:
 * `trip_cost_summary` is security_invoker and every admin policy ends in
 * `OR app.is_admin()`, so scoping is the database's answer, not ours.
 */
describe("dashboard and admin", () => {
  let app: FastifyInstance;
  let owner: TestSession;
  let friend: TestSession;
  let stranger: TestSession;
  let admin: TestSession;
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

  /** Promotes an account. Role is not settable through the API by design. */
  async function promoteToAdmin(user: TestSession): Promise<void> {
    await adminQuery("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
  }

  beforeEach(async () => {
    await truncateAll();
    owner = await registerUser(app);
    friend = await registerUser(app);
    stranger = await registerUser(app);
    admin = await registerUser(app);
    await promoteToAdmin(admin);

    const trip = await app.inject({
      method: "POST",
      url: "/api/v1/trips",
      headers: asUser(owner.accessToken),
      payload: {
        name: "Iberian loop",
        startDate: "2026-09-01",
        endDate: "2026-09-15",
        baseCurrency: "EUR",
        budgetCap: "2000.00",
      },
    });
    tripId = trip.json<{ data: { id: string } }>().data.id;
  });

  const summary = (user: TestSession) =>
    app.inject({
      method: "GET",
      url: "/api/v1/trips/summary",
      headers: asUser(user.accessToken),
    });

  async function addStop(costs: { arrivalCost?: string; lodgingCost?: string } = {}) {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/trips/${tripId}/stops`,
      headers: asUser(owner.accessToken),
      payload: {
        cityId: cities[0],
        arrivesAt: "2026-09-02T10:00:00Z",
        departsAt: "2026-09-06T10:00:00Z",
        ...costs,
      },
    });

    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

  describe("GET /trips/summary", () => {
    it("does not collide with GET /trips/:tripId", async () => {
      // "summary" is not a UUID, so if the parametric route won it would 422.
      const response = await summary(owner);

      expect(response.statusCode).toBe(200);
    });

    it("returns headline totals for the caller's trips", async () => {
      await addStop({ arrivalCost: "150.00", lodgingCost: "400.00" });

      const card = summary(owner).then(
        (r) => r.json<{ data: Record<string, unknown>[] }>().data[0],
      );

      expect(await card).toMatchObject({
        tripId,
        name: "Iberian loop",
        totalDays: 15,
        stopCount: 1,
        totalCost: "550.00",
        budgetCap: "2000.00",
        remaining: "1450.00",
        overBudget: false,
      });
    });

    it("reports a negative remaining rather than clamping at zero", async () => {
      await addStop({ arrivalCost: "1500.00", lodgingCost: "900.00" });

      const card = (await summary(owner)).json<{
        data: { remaining: string; overBudget: boolean }[];
      }>().data[0];

      expect(card?.remaining).toBe("-400.00");
      expect(card?.overBudget).toBe(true);
    });

    it("shows a stranger nothing, without the API filtering by owner", async () => {
      const response = await summary(stranger);

      // summary.repository.ts has no WHERE owner_id at all — security_invoker
      // makes the trips policies do this.
      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown[] }>().data).toHaveLength(0);
    });

    it("includes a trip shared with a collaborator", async () => {
      // Inserted directly rather than through the collaborators endpoint,
      // which lives in a separate PR — this test is about the VIEW honouring
      // can_read_trip, not about how the row got there.
      await adminQuery(
        "INSERT INTO trip_collaborators (trip_id, user_id, role, invited_by) VALUES ($1,$2,'viewer',$3)",
        [tripId, friend.id, owner.id],
      );

      const response = await summary(friend);

      // The half that an owner-only filter would have got wrong: filtering by
      // owner_id would hide this trip from someone entitled to see it.
      expect(response.json<{ data: { tripId: string }[] }>().data.map((t) => t.tripId)).toEqual([
        tripId,
      ]);
    });
  });

  describe("admin authorization", () => {
    it("refuses an ordinary user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/metrics",
        headers: asUser(owner.accessToken),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe("FORBIDDEN");
    });

    it("refuses an anonymous caller", async () => {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/metrics" });

      expect(response.statusCode).toBe(401);
    });

    it("admits an admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/metrics",
        headers: asUser(admin.accessToken),
      });

      expect(response.statusCode).toBe(200);
    });

    it("uses the role in the database, not the one in an old token", async () => {
      // The admin's token was minted before promotion, so if the guard trusted
      // only the JWT claim this would already have failed above. Demote and
      // re-check with the SAME token: access must go away.
      await adminQuery("UPDATE users SET role = 'traveler' WHERE id = $1", [admin.id]);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/metrics",
        headers: asUser(admin.accessToken),
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("GET /admin/metrics", () => {
    const metrics = (days?: number) =>
      app.inject({
        method: "GET",
        url: days === undefined ? "/api/v1/admin/metrics" : `/api/v1/admin/metrics?days=${days}`,
        headers: asUser(admin.accessToken),
      });

    it("counts everything, across all users", async () => {
      await addStop();

      const data = (await metrics()).json<{
        data: { totals: { users: number; trips: number; stops: number } };
      }>().data;

      expect(data.totals.users).toBe(4);
      expect(data.totals.trips).toBe(1);
      expect(data.totals.stops).toBe(1);
    });

    it("emits a dense day series, including zero days", async () => {
      const data = (await metrics(7)).json<{
        data: { tripsOverTime: { day: string; count: number }[] };
      }>().data;

      // A sparse series silently joins Monday to Wednesday on a line chart.
      expect(data.tripsOverTime).toHaveLength(7);
      expect(data.tripsOverTime.at(-1)?.count).toBe(1);
      expect(data.tripsOverTime.every((d) => typeof d.count === "number")).toBe(true);
    });

    it("counts a city once per trip, not once per stop", async () => {
      // Two stops in the same city, one trip.
      await addStop();
      await app.inject({
        method: "POST",
        url: `/api/v1/trips/${tripId}/stops`,
        headers: asUser(owner.accessToken),
        payload: {
          cityId: cities[0],
          arrivesAt: "2026-09-08T10:00:00Z",
          departsAt: "2026-09-10T10:00:00Z",
        },
      });

      const top = (await metrics()).json<{
        data: { topCities: { tripCount: number }[] };
      }>().data.topCities;

      expect(top[0]?.tripCount).toBe(1);
    });

    it("averages budget only over trips that set one", async () => {
      // A second trip with no budget must not drag the average toward zero.
      await app.inject({
        method: "POST",
        url: "/api/v1/trips",
        headers: asUser(owner.accessToken),
        payload: {
          name: "No budget",
          startDate: "2027-01-01",
          endDate: "2027-01-05",
          baseCurrency: "EUR",
        },
      });

      const averages = (await metrics()).json<{
        data: { averages: { budget: string | null } };
      }>().data.averages;

      expect(averages.budget).toBe("2000.00");
    });

    it("reports DAU and WAU from real sign-ins", async () => {
      const { engagement } = (await metrics()).json<{
        data: { engagement: { dau: number; wau: number } };
      }>().data;

      // Nothing wrote users.last_login_at before this change, so these were
      // structurally zero. registerUser signs each account in.
      expect(engagement.dau).toBeGreaterThan(0);
      expect(engagement.wau).toBeGreaterThanOrEqual(engagement.dau);
    });

    it("rejects an out-of-range window", async () => {
      expect((await metrics(5000)).statusCode).toBe(422);
    });
  });

  describe("GET /admin/users", () => {
    const users = (query = "") =>
      app.inject({
        method: "GET",
        url: `/api/v1/admin/users${query}`,
        headers: asUser(admin.accessToken),
      });

    it("lists every account with its trip count", async () => {
      const data = users().then((r) => r.json<{ data: { id: string; tripCount: number }[] }>());
      const body = await data;

      expect(body.data).toHaveLength(4);
      expect(body.data.find((u) => u.id === owner.id)?.tripCount).toBe(1);
      expect(body.data.find((u) => u.id === stranger.id)?.tripCount).toBe(0);
    });

    it("searches by email", async () => {
      const response = await users(`?q=${owner.email.split("@")[0] ?? ""}`);

      expect(response.json<{ data: { id: string }[] }>().data.map((u) => u.id)).toEqual([owner.id]);
    });

    it("filters by role", async () => {
      const response = await users("?role=admin");

      expect(response.json<{ data: { id: string }[] }>().data.map((u) => u.id)).toEqual([admin.id]);
    });

    it("hides suspended accounts unless asked", async () => {
      await adminQuery("UPDATE users SET deleted_at = now() WHERE id = $1", [stranger.id]);

      const hidden = await users();
      expect(hidden.json<{ data: { id: string }[] }>().data.map((u) => u.id)).not.toContain(
        stranger.id,
      );

      const shown = await users("?includeSuspended=true");
      expect(shown.json<{ data: { id: string }[] }>().data.map((u) => u.id)).toContain(
        stranger.id,
      );
    });

    it("paginates without repeating a row", async () => {
      const first = await users("?limit=2");
      const firstPage = first.json<{
        data: { id: string }[];
        page: { nextCursor: string | null; hasMore: boolean };
      }>();

      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.page.hasMore).toBe(true);

      const second = await users(`?limit=2&cursor=${String(firstPage.page.nextCursor)}`);
      const secondPage = second.json<{ data: { id: string }[] }>();

      const ids = [...firstPage.data, ...secondPage.data].map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("pages correctly when sorted by a timestamp containing a space", async () => {
      // The cursor is NUL-separated, not space-separated: an ISO timestamp
      // rendered by Postgres contains a space, and splitting on one would
      // truncate the key and restart the page.
      const first = await users("?sort=lastLoginAt&limit=2");
      const firstPage = first.json<{
        data: { id: string }[];
        page: { nextCursor: string | null };
      }>();

      const second = await users(
        `?sort=lastLoginAt&limit=2&cursor=${String(firstPage.page.nextCursor)}`,
      );
      const secondPage = second.json<{ data: { id: string }[] }>();

      const ids = [...firstPage.data, ...secondPage.data].map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
