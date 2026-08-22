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
 * Sharing (#20). The properties worth proving are negative ones: a revoked
 * link stops working, an unlisted trip is not readable without its slug, and
 * a public itinerary carries nothing that identifies its owner.
 */
describe("sharing API", () => {
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
        endDate: "2026-09-30",
        baseCurrency: "EUR",
        description: "Lisbon and Porto",
      },
    });
    tripId = trip.json<{ data: { id: string } }>().data.id;
  });

  async function addStop(
    cityIndex: number,
    from: string,
    to: string,
    trip: string = tripId,
  ): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/trips/${trip}/stops`,
      headers: asUser(owner.accessToken),
      payload: { cityId: cities[cityIndex], arrivesAt: from, departsAt: to },
    });

    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

  async function addActivity(stopId: string, title: string, from: string, to: string) {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/stops/${stopId}/activities`,
      headers: asUser(owner.accessToken),
      payload: { title, startsAt: from, endsAt: to },
    });

    expect(response.statusCode).toBe(201);
  }

  const share = (user: TestSession, visibility: "unlisted" | "public", trip = tripId) =>
    app.inject({
      method: "POST",
      url: `/api/v1/trips/${trip}/share`,
      headers: asUser(user.accessToken),
      payload: { visibility },
    });

  const readPublic = (slug: string) =>
    app.inject({ method: "GET", url: `/api/v1/public/${slug}` });

  async function shareAndGetSlug(visibility: "unlisted" | "public" = "unlisted") {
    const response = await share(owner, visibility);
    expect(response.statusCode).toBe(200);
    return response.json<{ data: { slug: string; url: string } }>().data;
  }

  describe("publishing", () => {
    it("mints an unguessable slug and an absolute link", async () => {
      const { slug, url } = await shareAndGetSlug();

      expect(slug).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      // Must not be derivable from the trip id.
      expect(slug).not.toContain(tripId.slice(0, 8));
      expect(url).toContain(slug);
    });

    it("returns the same link when shared again, rather than a second live slug", async () => {
      const first = await shareAndGetSlug();
      const second = await shareAndGetSlug();

      // Two live slugs would mean revoking felt done while one kept working.
      expect(second.slug).toBe(first.slug);
    });

    it("refuses to let a non-owner publish", async () => {
      const response = await share(stranger, "public");

      // The stranger cannot even see the trip, so this is a 404 by RLS.
      expect(response.statusCode).toBe(404);
    });

    it("refuses to narrow public back to unlisted", async () => {
      await share(owner, "public");

      const narrowing = await share(owner, "unlisted");

      expect(narrowing.statusCode).toBe(422);
    });
  });

  describe("reading a shared trip", () => {
    it("serves the itinerary to an anonymous caller holding the slug", async () => {
      const stopId = await addStop(0, "2026-09-02T10:00:00Z", "2026-09-06T10:00:00Z");
      await addActivity(stopId, "Alfama walking tour", "2026-09-03T10:00:00Z", "2026-09-03T13:00:00Z");

      const { slug } = await shareAndGetSlug();

      // No Authorization header anywhere in this request.
      const response = await readPublic(slug);

      expect(response.statusCode).toBe(200);

      const trip = response.json<{
        data: { name: string; stops: { cityName: string; activities: { title: string }[] }[] };
      }>().data;

      expect(trip.name).toBe("Iberian loop");
      expect(trip.stops).toHaveLength(1);
      expect(trip.stops[0]?.cityName).toEqual(expect.any(String));
      expect(trip.stops[0]?.activities.map((a) => a.title)).toEqual(["Alfama walking tour"]);
    });

    it("leaks nothing that identifies the owner", async () => {
      const { slug } = await shareAndGetSlug();

      const response = await readPublic(slug);
      const body = response.body;

      // The whole payload, not just the fields we remembered to check.
      expect(body).not.toContain(owner.id);
      expect(body).not.toContain(owner.email);
      expect(body).not.toContain("ownerId");
      expect(body).not.toContain("Test User");
    });

    it("404s an unknown slug", async () => {
      const response = await readPublic("aaaaaaaaaaaaaaaaaaaaaa");

      expect(response.statusCode).toBe(404);
    });

    it("422s a malformed slug rather than reaching the database", async () => {
      const response = await readPublic("short");

      expect(response.statusCode).toBe(422);
    });

    it("stops serving the trip once the link is revoked", async () => {
      const { slug } = await shareAndGetSlug();
      expect((await readPublic(slug)).statusCode).toBe(200);

      const revoked = await app.inject({
        method: "DELETE",
        url: `/api/v1/trips/${tripId}/share`,
        headers: asUser(owner.accessToken),
      });
      expect(revoked.statusCode).toBe(204);

      // Revocation is enforced by policy: can_read_trip only accepts an
      // unlisted trip whose share row is still live.
      expect((await readPublic(slug)).statusCode).toBe(404);
    });

    /**
     * TRIPWIRE — this asserts a known gap, not desired behaviour.
     *
     * View counting cannot work from the public path today: `trip_shares_write`
     * is FOR ALL and requires ownership, so the UPDATE from an anonymous
     * share-slug transaction matches zero rows. The read side is fine, because
     * `trip_shares_read` accepts a matching `app.share_slug`.
     *
     * The fix is a SECURITY DEFINER `app.record_share_view(text)` (proposed in
     * the PR). When that lands this expectation FAILS, which is the point —
     * change the 0 to a 2 and delete this comment.
     */
    it("does not count views yet, pending app.record_share_view", async () => {
      const { slug } = await shareAndGetSlug();

      await readPublic(slug);
      await readPublic(slug);

      const response = await share(owner, "unlisted");
      expect(response.json<{ data: { viewCount: number } }>().data.viewCount).toBe(0);
    });

    it("serves Open Graph metadata for previews", async () => {
      await addStop(0, "2026-09-02T10:00:00Z", "2026-09-06T10:00:00Z");
      const { slug } = await shareAndGetSlug();

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/public/${slug}/og`,
      });

      expect(response.statusCode).toBe(200);

      const og = response.json<{ data: { title: string; url: string; type: string } }>().data;
      expect(og.title).toBe("Iberian loop");
      expect(og.url).toContain(slug);
      expect(og.type).toBe("website");
    });
  });

  describe("copying", () => {
    async function tripWithGraph(): Promise<void> {
      const first = await addStop(0, "2026-09-02T10:00:00Z", "2026-09-06T10:00:00Z");
      const second = await addStop(1, "2026-09-07T10:00:00Z", "2026-09-10T10:00:00Z");

      await addActivity(first, "Alfama walking tour", "2026-09-03T10:00:00Z", "2026-09-03T13:00:00Z");
      await addActivity(first, "Tram 28", "2026-09-04T10:00:00Z", "2026-09-04T11:00:00Z");
      await addActivity(second, "Livraria Lello", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z");
    }

    const copy = (user: TestSession, trip = tripId, name?: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/trips/${trip}/copy`,
        headers: asUser(user.accessToken),
        payload: name === undefined ? {} : { name },
      });

    it("deep-clones stops and activities into a trip the caller owns", async () => {
      await tripWithGraph();
      await share(owner, "public");

      const response = await copy(stranger);

      expect(response.statusCode).toBe(201);

      const copied = response.json<{
        data: { id: string; ownerId: string; name: string; stopCount: number; activityCount: number };
      }>().data;

      expect(copied.ownerId).toBe(stranger.id);
      expect(copied.name).toBe("Copy of Iberian loop");
      expect(copied.stopCount).toBe(2);
      expect(copied.activityCount).toBe(3);
      // A copy is a new trip, not a second reference to the original.
      expect(copied.id).not.toBe(tripId);
    });

    it("gives the copier their own editable trip", async () => {
      await tripWithGraph();
      await share(owner, "public");

      const copied = await copy(stranger);
      const newTripId = copied.json<{ data: { id: string } }>().data.id;

      const stops = await app.inject({
        method: "GET",
        url: `/api/v1/trips/${newTripId}/stops`,
        headers: asUser(stranger.accessToken),
      });

      expect(stops.statusCode).toBe(200);
      expect(stops.json<{ data: { seq: number }[] }>().data.map((s) => s.seq)).toEqual([1, 2]);
    });

    it("starts the copy private and in draft, never inheriting the source's visibility", async () => {
      await tripWithGraph();
      await share(owner, "public");

      const copied = await copy(stranger);
      const newTripId = copied.json<{ data: { id: string } }>().data.id;

      const trip = await app.inject({
        method: "GET",
        url: `/api/v1/trips/${newTripId}`,
        headers: asUser(stranger.accessToken),
      });

      expect(trip.json<{ data: { visibility: string; status: string } }>().data).toMatchObject({
        visibility: "private",
        status: "draft",
      });
    });

    it("does not let the copy appear in the original owner's trip list", async () => {
      await tripWithGraph();
      await share(owner, "public");
      await copy(stranger);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/trips",
        headers: asUser(owner.accessToken),
      });

      expect(list.json<{ data: unknown[] }>().data).toHaveLength(1);
    });

    it("refuses to copy a trip the caller cannot see", async () => {
      await tripWithGraph();

      // Never shared, so RLS hides it entirely.
      const response = await copy(stranger);

      expect(response.statusCode).toBe(404);
    });

    it("accepts a caller-supplied name", async () => {
      await tripWithGraph();
      await share(owner, "public");

      const response = await copy(stranger, tripId, "My Iberian plans");

      expect(response.json<{ data: { name: string } }>().data.name).toBe("My Iberian plans");
    });

    it("copies an empty trip without inventing stops", async () => {
      await share(owner, "public");

      const response = await copy(stranger);

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: { stopCount: number; activityCount: number } }>().data)
        .toMatchObject({ stopCount: 0, activityCount: 0 });
    });
  });
});
