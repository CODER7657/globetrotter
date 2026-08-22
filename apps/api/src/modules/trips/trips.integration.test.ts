import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, buildTestApp, closeHarness, registerUser, truncateAll } from "../../test/harness.js";
import type { FastifyInstance } from "fastify";
import type { TestSession } from "../../test/harness.js";

/**
 * The proof that issue #13 is done: one request travelling routes -> service
 * -> repository -> Postgres and back, with RLS doing the authorization.
 */
describe("trips API", () => {
  let app: FastifyInstance;
  let owner: TestSession;
  let stranger: TestSession;

  const validTrip = {
    name: "Iberian loop",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    baseCurrency: "EUR",
    description: "Lisbon, Seville, Granada",
  };

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeHarness();
  });

  beforeEach(async () => {
    await truncateAll();
    owner = await registerUser(app);
    stranger = await registerUser(app);
  });

  const createTrip = (user: TestSession, body: Record<string, unknown> = validTrip) =>
    app.inject({
      method: "POST",
      url: "/api/v1/trips",
      headers: asUser(user.accessToken),
      payload: body,
    });

  describe("POST /trips", () => {
    it("creates a trip and returns it with a Location header", async () => {
      const response = await createTrip(owner);

      expect(response.statusCode).toBe(201);

      const body = response.json<{ data: Record<string, unknown> }>();
      expect(body.data).toMatchObject({
        name: "Iberian loop",
        // Inclusive on the way in and on the way out, even though the database
        // stores a half-open [) daterange.
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        ownerId: owner.id,
        status: "draft",
        visibility: "private",
        baseCurrency: "EUR",
        version: 1,
      });
      expect(response.headers["location"]).toBe(`/api/v1/trips/${String(body.data["id"])}`);
    });

    it("rejects a trip whose end date precedes its start date", async () => {
      const response = await createTrip(owner, {
        ...validTrip,
        startDate: "2026-09-20",
        endDate: "2026-09-01",
      });

      expect(response.statusCode).toBe(422);
      expect(response.headers["content-type"]).toContain("application/problem+json");

      const problem = response.json<{
        code: string;
        traceId: string;
        errors: { path: string }[];
      }>();
      expect(problem.code).toBe("VALIDATION_FAILED");
      expect(problem.traceId).toEqual(expect.any(String));
      expect(problem.errors.map((e) => e.path)).toContain("endDate");
    });

    it("refuses a request with no identity", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/trips",
        payload: validTrip,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json<{ code: string }>().code).toBe("UNAUTHENTICATED");
    });
  });

  describe("GET /trips/:tripId", () => {
    it("returns the trip with its version as an ETag", async () => {
      const created = await createTrip(owner);
      const tripId = created.json<{ data: { id: string } }>().data.id;

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/trips/${tripId}`,
        headers: asUser(owner.accessToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["etag"]).toBe('"1"');
      expect(response.json<{ data: { id: string } }>().data.id).toBe(tripId);
    });

    it("hides another user's private trip behind a 404, not a 403", async () => {
      const created = await createTrip(owner);
      const tripId = created.json<{ data: { id: string } }>().data.id;

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/trips/${tripId}`,
        headers: asUser(stranger.accessToken),
      });

      // RLS filtered the row out entirely — the service never saw it, so the
      // API cannot even confirm that this trip exists.
      expect(response.statusCode).toBe(404);
      expect(response.json<{ code: string }>().code).toBe("NOT_FOUND");
    });

    it("returns 422 for a tripId that is not a UUID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/trips/not-a-uuid",
        headers: asUser(owner.accessToken),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<{ code: string }>().code).toBe("VALIDATION_FAILED");
    });
  });

  describe("GET /trips", () => {
    it("paginates by cursor and never repeats a row across pages", async () => {
      for (const name of ["one", "two", "three"]) {
        const response = await createTrip(owner, { ...validTrip, name });
        expect(response.statusCode).toBe(201);
      }

      const first = await app.inject({
        method: "GET",
        url: "/api/v1/trips?limit=2",
        headers: asUser(owner.accessToken),
      });

      expect(first.statusCode).toBe(200);
      const firstPage = first.json<{
        data: { id: string }[];
        page: { nextCursor: string | null; hasMore: boolean };
      }>();
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.page.hasMore).toBe(true);
      expect(firstPage.page.nextCursor).toEqual(expect.any(String));

      const second = await app.inject({
        method: "GET",
        url: `/api/v1/trips?limit=2&cursor=${String(firstPage.page.nextCursor)}`,
        headers: asUser(owner.accessToken),
      });

      const secondPage = second.json<{
        data: { id: string }[];
        page: { hasMore: boolean };
      }>();
      expect(secondPage.data).toHaveLength(1);
      expect(secondPage.page.hasMore).toBe(false);

      const ids = [...firstPage.data, ...secondPage.data].map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("does not leak another user's trips into the list", async () => {
      await createTrip(owner);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/trips",
        headers: asUser(stranger.accessToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown[] }>().data).toHaveLength(0);
    });
  });
});
