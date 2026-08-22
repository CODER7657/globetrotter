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
 * Optimistic concurrency and collaborators.
 *
 * The property under test is the demo beat: two people editing one trip, and
 * the stale write losing loudly rather than silently winning.
 */
describe("If-Match and collaborators", () => {
  let app: FastifyInstance;
  let owner: TestSession;
  let friend: TestSession;
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
    friend = await registerUser(app);
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
    tripId = trip.json<{ data: { id: string } }>().data.id;
  });

  const readTrip = (user: TestSession) =>
    app.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}`,
      headers: asUser(user.accessToken),
    });

  const patchTrip = (
    user: TestSession,
    payload: Record<string, unknown>,
    ifMatch?: string,
  ) =>
    app.inject({
      method: "PATCH",
      url: `/api/v1/trips/${tripId}`,
      headers: {
        ...asUser(user.accessToken),
        ...(ifMatch === undefined ? {} : { "if-match": ifMatch }),
      },
      payload,
    });

  const addStop = (user: TestSession, from: string, to: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/trips/${tripId}/stops`,
      headers: asUser(user.accessToken),
      payload: { cityId: cities[0], arrivesAt: from, departsAt: to },
    });

  describe("versioning", () => {
    it("exposes the version as an ETag on read", async () => {
      const response = await readTrip(owner);

      expect(response.headers["etag"]).toBe('"1"');
      expect(response.json<{ data: { version: number } }>().data.version).toBe(1);
    });

    it("advances the version when a STOP changes, not just the trip", async () => {
      const before = (await readTrip(owner)).json<{ data: { version: number } }>().data.version;

      const stop = await addStop(owner, "2026-09-02T10:00:00Z", "2026-09-05T10:00:00Z");
      expect(stop.statusCode).toBe(201);

      const after = (await readTrip(owner)).json<{ data: { version: number } }>().data.version;

      // This is what makes one version guard the whole itinerary: without it,
      // If-Match on the trip would not notice a concurrent edit to a stop.
      expect(after).toBeGreaterThan(before);
    });
  });

  describe("If-Match", () => {
    it("applies the write when the version matches", async () => {
      const etag = String((await readTrip(owner)).headers["etag"]);

      const response = await patchTrip(owner, { name: "Iberian loop v2" }, etag);

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { name: string } }>().data.name).toBe("Iberian loop v2");
    });

    it("refuses a stale write and says what the server actually holds", async () => {
      const stale = String((await readTrip(owner)).headers["etag"]);

      // Someone else moves the trip on.
      await patchTrip(owner, { name: "Moved on" });

      const response = await patchTrip(owner, { name: "Stale write" }, stale);

      expect(response.statusCode).toBe(409);

      const problem = response.json<{ code: string; currentVersion: number }>();
      expect(problem.code).toBe("VERSION_MISMATCH");
      // Without this the client must re-fetch to learn what it lost, mid-race.
      expect(problem.currentVersion).toBeGreaterThan(Number(stale.replaceAll('"', "")));

      // And the stale write did not land.
      const current = (await readTrip(owner)).json<{ data: { name: string } }>().data.name;
      expect(current).toBe("Moved on");
    });

    it("notices a concurrent STOP edit, not only a trip edit", async () => {
      const etag = String((await readTrip(owner)).headers["etag"]);

      await addStop(owner, "2026-09-02T10:00:00Z", "2026-09-05T10:00:00Z");

      const response = await patchTrip(owner, { name: "Stale" }, etag);

      expect(response.statusCode).toBe(409);
    });

    it("proceeds when no precondition is sent, per RFC 9110", async () => {
      const response = await patchTrip(owner, { name: "Unconditional" });

      expect(response.statusCode).toBe(200);
    });

    it("accepts W/ and bare forms, and treats * as satisfied", async () => {
      expect((await patchTrip(owner, { name: "a" }, 'W/"1"')).statusCode).toBe(200);

      const v2 = String((await readTrip(owner)).headers["etag"]).replaceAll('"', "");
      expect((await patchTrip(owner, { name: "b" }, v2)).statusCode).toBe(200);

      expect((await patchTrip(owner, { name: "c" }, "*")).statusCode).toBe(200);
    });

    it("rejects a malformed precondition rather than ignoring it", async () => {
      const response = await patchTrip(owner, { name: "x" }, "not-a-version");

      // Silently ignoring an unparseable If-Match is how a stale write sneaks
      // through believing it was checked.
      expect(response.statusCode).toBe(422);
    });

    it("guards deletion the same way", async () => {
      const stale = String((await readTrip(owner)).headers["etag"]);
      await patchTrip(owner, { name: "Moved on" });

      const conflict = await app.inject({
        method: "DELETE",
        url: `/api/v1/trips/${tripId}`,
        headers: { ...asUser(owner.accessToken), "if-match": stale },
      });
      expect(conflict.statusCode).toBe(409);

      const fresh = String((await readTrip(owner)).headers["etag"]);
      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/v1/trips/${tripId}`,
        headers: { ...asUser(owner.accessToken), "if-match": fresh },
      });
      expect(deleted.statusCode).toBe(204);

      // Soft-deleted, so it is gone from the API.
      expect((await readTrip(owner)).statusCode).toBe(404);
    });
  });

  describe("collaborators", () => {
    const invite = (user: TestSession, email: string, role = "editor") =>
      app.inject({
        method: "POST",
        url: `/api/v1/trips/${tripId}/collaborators`,
        headers: asUser(user.accessToken),
        payload: { email, role },
      });

    it("lets the owner invite someone by email", async () => {
      const response = await invite(owner, friend.email);

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: Record<string, unknown> }>().data).toMatchObject({
        userId: friend.id,
        role: "editor",
        invitedBy: owner.id,
      });
    });

    it("gives an editor real access to the trip", async () => {
      // Before the invite the trip does not exist as far as they are concerned.
      expect((await readTrip(friend)).statusCode).toBe(404);

      await invite(owner, friend.email, "editor");

      expect((await readTrip(friend)).statusCode).toBe(200);

      // And they can actually edit it — can_edit_trip covers editors.
      const stop = await addStop(friend, "2026-09-02T10:00:00Z", "2026-09-05T10:00:00Z");
      expect(stop.statusCode).toBe(201);
    });

    it("gives a viewer read access but not write", async () => {
      await invite(owner, friend.email, "viewer");

      expect((await readTrip(friend)).statusCode).toBe(200);

      // can_edit_trip requires role = 'editor', so the write is refused by
      // policy rather than by a check in the service.
      const stop = await addStop(friend, "2026-09-02T10:00:00Z", "2026-09-05T10:00:00Z");
      expect(stop.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("refuses to let a non-owner invite anyone", async () => {
      await invite(owner, friend.email, "editor");

      // An editor can change the itinerary but not the guest list.
      const response = await invite(friend, stranger.email);

      expect(response.statusCode).toBe(403);
    });

    it("404s an email with no account", async () => {
      const response = await invite(owner, "nobody@example.test");

      expect(response.statusCode).toBe(404);
    });

    it("refuses a duplicate invite", async () => {
      await invite(owner, friend.email);

      const again = await invite(owner, friend.email);

      expect(again.statusCode).toBe(409);
      expect(again.json<{ code: string }>().code).toBe("DUPLICATE");
    });

    it("refuses to add the owner as their own collaborator", async () => {
      const response = await invite(owner, owner.email);

      expect(response.statusCode).toBe(409);
    });

    it("removes a collaborator and their access with them", async () => {
      await invite(owner, friend.email, "editor");
      expect((await readTrip(friend)).statusCode).toBe(200);

      const removed = await app.inject({
        method: "DELETE",
        url: `/api/v1/trips/${tripId}/collaborators/${friend.id}`,
        headers: asUser(owner.accessToken),
      });

      expect(removed.statusCode).toBe(204);
      expect((await readTrip(friend)).statusCode).toBe(404);
    });

    it("404s removing someone who is not a collaborator", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/trips/${tripId}/collaborators/${stranger.id}`,
        headers: asUser(owner.accessToken),
      });

      expect(response.statusCode).toBe(404);
    });

    it("lists collaborators to anyone who can read the trip", async () => {
      await invite(owner, friend.email, "editor");

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/trips/${tripId}/collaborators`,
        headers: asUser(friend.accessToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { userId: string }[] }>().data).toHaveLength(1);
    });
  });
});
