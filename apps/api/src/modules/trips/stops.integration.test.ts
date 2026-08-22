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
 * Stops are where the schema's temporal guarantees become visible, so most of
 * these assert that an impossible itinerary is refused by the database rather
 * than by a service-layer check.
 */
describe("stops API", () => {
  let app: FastifyInstance;
  let owner: TestSession;
  let stranger: TestSession;
  let cities: string[];
  let tripId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
    cities = await pickCities(3);
  });

  afterAll(async () => {
    await app.close();
    await closeHarness();
  });

  beforeEach(async () => {
    await truncateAll();
    owner = await registerUser(app);
    stranger = await registerUser(app);

    const created = await app.inject({
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

    tripId = created.json<{ data: { id: string } }>().data.id;
  });

  const addStop = (
    user: TestSession,
    payload: Record<string, unknown>,
    trip: string = tripId,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/trips/${trip}/stops`,
      headers: asUser(user.accessToken),
      payload,
    });

  const stop = (cityIndex: number, from: string, to: string) => ({
    cityId: cities[cityIndex],
    arrivesAt: from,
    departsAt: to,
  });

  const listStops = (user: TestSession) =>
    app.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}/stops`,
      headers: asUser(user.accessToken),
    });

  describe("creating stops", () => {
    it("appends stops in 1-based visiting order", async () => {
      await addStop(owner, stop(0, "2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z"));
      await addStop(owner, stop(1, "2026-09-06T10:00:00Z", "2026-09-10T10:00:00Z"));

      const response = await listStops(owner);
      const seqs = response.json<{ data: { seq: number }[] }>().data.map((s) => s.seq);

      expect(seqs).toEqual([1, 2]);
    });

    it("refuses two stops that overlap in time, and names the constraint", async () => {
      await addStop(owner, stop(0, "2026-09-01T10:00:00Z", "2026-09-10T10:00:00Z"));

      const clash = await addStop(owner, stop(1, "2026-09-05T10:00:00Z", "2026-09-12T10:00:00Z"));

      expect(clash.statusCode).toBe(409);

      const problem = clash.json<{ code: string; constraint: string; detail: string }>();
      expect(problem.code).toBe("OVERLAP");
      // The UI needs the machine-readable name to write the good sentence.
      expect(problem.constraint).toBe("trip_stops_no_overlap");
      expect(problem.detail).toBeTruthy();
    });

    it("rejects a departure that precedes its arrival", async () => {
      const response = await addStop(
        owner,
        stop(0, "2026-09-10T10:00:00Z", "2026-09-01T10:00:00Z"),
      );

      expect(response.statusCode).toBe(422);
      expect(
        response.json<{ errors: { path: string }[] }>().errors.map((e) => e.path),
      ).toContain("departsAt");
    });

    it("hides another user's trip behind a 404", async () => {
      const response = await addStop(
        stranger,
        stop(0, "2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z"),
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe("reordering", () => {
    async function threeStops(): Promise<string[]> {
      const ids: string[] = [];
      const windows: [string, string][] = [
        ["2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z"],
        ["2026-09-06T10:00:00Z", "2026-09-10T10:00:00Z"],
        ["2026-09-11T10:00:00Z", "2026-09-15T10:00:00Z"],
      ];

      for (const [index, window] of windows.entries()) {
        const response = await addStop(owner, stop(index, window[0], window[1]));
        expect(response.statusCode).toBe(201);
        ids.push(response.json<{ data: { id: string } }>().data.id);
      }

      return ids;
    }

    const reorder = (user: TestSession, stopIds: string[]) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/trips/${tripId}/stops/order`,
        headers: asUser(user.accessToken),
        payload: { stopIds },
      });

    it("reverses the order in a single statement", async () => {
      const ids = await threeStops();
      const reversed = [...ids].reverse();

      const response = await reorder(owner, reversed);

      expect(response.statusCode).toBe(200);

      // A naive loop of UPDATEs would trip the unique constraint partway
      // through; this passes because it is one statement against a DEFERRABLE
      // constraint checked at COMMIT.
      const returned = response.json<{ data: { id: string; seq: number }[] }>().data;
      expect(returned.map((s) => s.id)).toEqual(reversed);
      expect(returned.map((s) => s.seq)).toEqual([1, 2, 3]);
    });

    it("survives a swap of two adjacent positions", async () => {
      const ids = await threeStops();
      const swapped = [ids[1], ids[0], ids[2]] as string[];

      const response = await reorder(owner, swapped);

      expect(response.statusCode).toBe(200);
      expect(
        response.json<{ data: { id: string }[] }>().data.map((s) => s.id),
      ).toEqual(swapped);
    });

    it("refuses a partial list, which would leave stale positions behind", async () => {
      const ids = await threeStops();

      const response = await reorder(owner, ids.slice(0, 2));

      expect(response.statusCode).toBe(422);
    });

    it("refuses a list containing a duplicate", async () => {
      const ids = await threeStops();
      const duplicated = [ids[0], ids[0], ids[1]] as string[];

      expect((await reorder(owner, duplicated)).statusCode).toBe(422);
    });

    it("refuses an id belonging to another trip", async () => {
      const ids = await threeStops();

      const otherTrip = await app.inject({
        method: "POST",
        url: "/api/v1/trips",
        headers: asUser(owner.accessToken),
        payload: {
          name: "Nordic run",
          startDate: "2027-01-01",
          endDate: "2027-01-20",
          baseCurrency: "EUR",
        },
      });
      const otherTripId = otherTrip.json<{ data: { id: string } }>().data.id;

      const foreign = await addStop(
        owner,
        stop(0, "2027-01-02T10:00:00Z", "2027-01-05T10:00:00Z"),
        otherTripId,
      );
      const foreignId = foreign.json<{ data: { id: string } }>().data.id;

      const response = await reorder(owner, [ids[0], ids[1], foreignId] as string[]);

      expect(response.statusCode).toBe(422);
    });
  });

  describe("updating and deleting", () => {
    async function oneStop(): Promise<string> {
      const response = await addStop(
        owner,
        stop(0, "2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z"),
      );

      return response.json<{ data: { id: string } }>().data.id;
    }

    it("moves only the edge named in the patch", async () => {
      const stopId = await oneStop();

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/stops/${stopId}`,
        headers: asUser(owner.accessToken),
        payload: { departsAt: "2026-09-07T10:00:00Z" },
      });

      expect(response.statusCode).toBe(200);

      const updated = response.json<{ data: { arrivesAt: string; departsAt: string } }>().data;
      expect(updated.departsAt).toBe("2026-09-07T10:00:00.000Z");
      // The untouched edge is preserved even though both live in one column.
      expect(updated.arrivesAt).toBe("2026-09-01T10:00:00.000Z");
    });

    it("rejects a patch that would invert the range", async () => {
      const stopId = await oneStop();

      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/stops/${stopId}`,
        headers: asUser(owner.accessToken),
        payload: { departsAt: "2026-08-01T10:00:00Z" },
      });

      expect(response.statusCode).toBe(422);
    });

    it("deletes a stop", async () => {
      const stopId = await oneStop();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/stops/${stopId}`,
        headers: asUser(owner.accessToken),
      });

      expect(response.statusCode).toBe(204);
      expect(await listStops(owner).then((r) => r.json<{ data: unknown[] }>().data)).toHaveLength(
        0,
      );
    });

    it("will not let a stranger delete a stop", async () => {
      const stopId = await oneStop();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/stops/${stopId}`,
        headers: asUser(stranger.accessToken),
      });

      expect(response.statusCode).toBe(404);
      expect(await listStops(owner).then((r) => r.json<{ data: unknown[] }>().data)).toHaveLength(
        1,
      );
    });
  });
});
