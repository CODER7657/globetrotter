import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  adminQuery,
  buildTestApp,
  closeHarness,
  registerUser,
  pickCity,
  truncateAll,
} from "../../test/harness.js";
import type { FastifyInstance } from "fastify";

/**
 * These tests exercise the real transport: a real server socket, a real
 * WebSocket client, and a real NOTIFY emitted by a real trigger on a real
 * write. Nothing is stubbed.
 *
 * That matters more here than anywhere else in the suite. LISTEN/NOTIFY has one
 * classic failure mode — registering LISTEN on a POOLED connection, so the
 * subscription is silently dropped when the connection returns to the pool.
 * A mocked listener would pass happily while production never delivered an
 * event. The only way to know is to make the round trip.
 */

const OPEN_TIMEOUT_MS = 5_000;

describe("realtime", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    baseUrl = `ws://127.0.0.1:${address.port}/api/v1`;
  });

  afterAll(async () => {
    await app.close();
    await closeHarness();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /** Opens a socket and resolves once it is connected. */
  function open(path: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${baseUrl}${path}`, { origin: "http://localhost:5173" });
      const timer = setTimeout(() => reject(new Error("open timed out")), OPEN_TIMEOUT_MS);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /** Resolves with the next frame whose `type` matches. */
  function nextFrame(ws: WebSocket, type: string, timeoutMs = OPEN_TIMEOUT_MS): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${type}" frame in ${timeoutMs}ms`)), timeoutMs);
      const onMessage = (raw: Buffer): void => {
        const frame = JSON.parse(raw.toString("utf8")) as { type: string };
        if (frame.type !== type) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(frame);
      };
      ws.on("message", onMessage);
    });
  }

  /** Resolves with the close code. */
  function nextClose(ws: WebSocket, timeoutMs = OPEN_TIMEOUT_MS): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no close")), timeoutMs);
      ws.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  async function makeTrip(userId: string): Promise<string> {
    const rows = await adminQuery<{ id: string }>(
      `INSERT INTO trips (owner_id, name, period, base_currency)
       VALUES ($1, 'RT trip', '[2027-04-01,2027-04-08)', 'INR') RETURNING id`,
      [userId],
    );
    return rows[0]!.id;
  }

  describe("authentication", () => {
    it("closes a socket that never authenticates", async () => {
      const user = await registerUser(app);
      const tripId = await makeTrip(user.id);
      const ws = await open(`/trips/${tripId}/live`);

      // AUTH_TIMEOUT_MS is 5s in the route.
      await expect(nextClose(ws, 8_000)).resolves.toBe(4401);
    });

    it("rejects a forged token", async () => {
      const user = await registerUser(app);
      const tripId = await makeTrip(user.id);
      const ws = await open(`/trips/${tripId}/live`);

      ws.send(JSON.stringify({ type: "auth", token: "not-a-real-token" }));
      await expect(nextClose(ws)).resolves.toBe(4401);
    });

    it("hides another user's trip behind 4404, not 4403", async () => {
      const owner = await registerUser(app);
      const stranger = await registerUser(app);
      const tripId = await makeTrip(owner.id);

      const ws = await open(`/trips/${tripId}/live`);
      ws.send(JSON.stringify({ type: "auth", token: stranger.accessToken }));

      // Existence is not disclosed — same posture as the REST 404.
      await expect(nextClose(ws)).resolves.toBe(4404);
    });

    it("admits the owner", async () => {
      const user = await registerUser(app);
      const tripId = await makeTrip(user.id);

      const ws = await open(`/trips/${tripId}/live`);
      ws.send(JSON.stringify({ type: "auth", token: user.accessToken }));

      const ready = await nextFrame(ws, "ready");
      expect(ready.tripId).toBe(tripId);
      ws.close();
    });
  });

  describe("delivery", () => {
    it("delivers a NOTIFY raised by a write from an entirely separate connection", async () => {
      const user = await registerUser(app);
      const tripId = await makeTrip(user.id);
      const cityId = await pickCity();

      const ws = await open(`/trips/${tripId}/live`);
      ws.send(JSON.stringify({ type: "auth", token: user.accessToken }));
      await nextFrame(ws, "ready");

      const changed = nextFrame(ws, "trip.changed");

      // Written through the admin pool — a different connection entirely, which
      // is the point: this proves the path is the database's, not an in-process
      // event emitter that happens to work because it is all one process.
      await adminQuery(
        `INSERT INTO trip_stops (trip_id, city_id, seq, period)
         VALUES ($1, $2, 1, '[2027-04-01 00:00+00,2027-04-03 00:00+00)')`,
        [tripId, cityId],
      );

      const event = await changed;
      expect(event).toMatchObject({ type: "trip.changed", trip: tripId, entity: "stop", op: "INSERT" });
      // The version travels with the event so a client can discard a stale one.
      expect(event.version).toBeGreaterThan(1);
      ws.close();
    });

    it("carries ids only — never row data", async () => {
      const user = await registerUser(app);
      const tripId = await makeTrip(user.id);
      const cityId = await pickCity();

      const ws = await open(`/trips/${tripId}/live`);
      ws.send(JSON.stringify({ type: "auth", token: user.accessToken }));
      await nextFrame(ws, "ready");

      const changed = nextFrame(ws, "trip.changed");
      await adminQuery(
        `INSERT INTO trip_stops (trip_id, city_id, seq, period, notes)
         VALUES ($1, $2, 1, '[2027-04-01 00:00+00,2027-04-03 00:00+00)', 'SECRET NOTE')`,
        [tripId, cityId],
      );

      const event = await changed;
      // A payload carrying row data would bypass RLS: the listener connection is
      // not the requesting user, so it cannot be what decides who sees what.
      expect(JSON.stringify(event)).not.toContain("SECRET NOTE");
      expect(Object.keys(event).sort()).toEqual(
        ["actor", "at", "entity", "id", "op", "trip", "type", "version"].sort(),
      );
      ws.close();
    });

    it("answers a ping", async () => {
      const user = await registerUser(app);
      const tripId = await makeTrip(user.id);
      const ws = await open(`/trips/${tripId}/live`);
      ws.send(JSON.stringify({ type: "auth", token: user.accessToken }));
      await nextFrame(ws, "ready");

      ws.send(JSON.stringify({ type: "ping" }));
      await expect(nextFrame(ws, "pong")).resolves.toMatchObject({ type: "pong" });
      ws.close();
    });
  });

  describe("presence", () => {
    it("records a viewer and clears the row on disconnect", async () => {
      const user = await registerUser(app);
      const tripId = await makeTrip(user.id);

      const ws = await open(`/trips/${tripId}/live`);
      ws.send(JSON.stringify({ type: "auth", token: user.accessToken }));
      await nextFrame(ws, "ready");

      const during = await adminQuery<{ n: string }>(
        "SELECT count(*)::text AS n FROM trip_presence WHERE trip_id = $1", [tripId],
      );
      expect(during[0]!.n).toBe("1");

      ws.close();
      await new Promise((r) => setTimeout(r, 500));

      const after = await adminQuery<{ n: string }>(
        "SELECT count(*)::text AS n FROM trip_presence WHERE trip_id = $1", [tripId],
      );
      expect(after[0]!.n).toBe("0");
    });
  });
});
