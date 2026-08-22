import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminQuery,
  asUser,
  buildTestApp,
  closeHarness,
  registerUser,
  truncateAll,
} from "../../test/harness.js";
import type { FastifyInstance } from "fastify";
import type { TestSession } from "../../test/harness.js";

/**
 * Presence reads (#66).
 *
 * Rows are inserted directly rather than by opening sockets: the WebSocket
 * layer owns writing presence and is tested separately, and driving real
 * connections here would make these tests about timing rather than about the
 * read.
 */
describe("presence API", () => {
  let app: FastifyInstance;
  let owner: TestSession;
  let friend: TestSession;
  let stranger: TestSession;
  let tripId: string;

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
    friend = await registerUser(app);
    stranger = await registerUser(app);

    const trip = await app.inject({
      method: "POST",
      url: "/api/v1/trips",
      headers: asUser(owner.accessToken),
      payload: {
        name: "Iberian loop",
        startDate: "2026-09-01",
        endDate: "2026-09-15",
        baseCurrency: "EUR",
      },
    });
    tripId = trip.json<{ data: { id: string } }>().data.id;
  });

  /** @param secondsAgo how long since this connection last checked in. */
  async function markPresent(user: TestSession, secondsAgo = 0): Promise<void> {
    await adminQuery(
      `INSERT INTO trip_presence (trip_id, user_id, connection, last_seen)
       VALUES ($1, $2, gen_random_uuid(), now() - make_interval(secs => $3::int))`,
      [tripId, user.id, secondsAgo],
    );
  }

  const presence = (user: TestSession, trip = tripId) =>
    app.inject({
      method: "GET",
      url: `/api/v1/trips/${trip}/presence`,
      headers: asUser(user.accessToken),
    });

  it("reports nobody on a quiet trip", async () => {
    const response = await presence(owner);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { viewers: unknown[] } }>().data.viewers).toEqual([]);
  });

  it("lists who is viewing", async () => {
    await markPresent(owner);
    await markPresent(friend);

    const viewers = (await presence(owner)).json<{
      data: { viewers: { userId: string }[] };
    }>().data.viewers;

    expect(viewers.map((v) => v.userId).sort()).toEqual([owner.id, friend.id].sort());
  });

  it("counts one person with two tabs as one viewer", async () => {
    await markPresent(owner);
    await markPresent(owner);

    const viewers = (await presence(owner)).json<{
      data: { viewers: { userId: string; connections: number }[] };
    }>().data.viewers;

    // An avatar bar should show one face, not two — but the connection count
    // is still available for a client that wants to say "2 tabs".
    expect(viewers).toHaveLength(1);
    expect(viewers[0]?.connections).toBe(2);
  });

  it("ignores a connection that stopped heartbeating", async () => {
    await markPresent(owner, 5);
    await markPresent(friend, 300);

    const viewers = (await presence(owner)).json<{
      data: { viewers: { userId: string }[] };
    }>().data.viewers;

    // 300s is well past the 90s window the WebSocket reaper uses. A ghost
    // avatar is worse than no presence bar.
    expect(viewers.map((v) => v.userId)).toEqual([owner.id]);
  });

  it("does not delete anything, because GET must not mutate", async () => {
    await markPresent(friend, 300);

    await presence(owner);

    // A safe method that reaps would let a browser prefetch or a crawler
    // silently disconnect people. The WebSocket layer owns the deleting.
    const rows = await adminQuery<{ n: string }>(
      "SELECT count(*)::text AS n FROM trip_presence WHERE trip_id = $1",
      [tripId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("publishes the staleness window so clients need not guess", async () => {
    const data = (await presence(owner)).json<{
      data: { staleAfterSeconds: number };
    }>().data;

    expect(data.staleAfterSeconds).toBe(90);
  });

  it("hides a trip the caller cannot see", async () => {
    await markPresent(owner);

    const response = await presence(stranger);

    // 404, not an empty list: a client must be able to tell a quiet trip from
    // one it has lost access to.
    expect(response.statusCode).toBe(404);
  });

  it("lets a collaborator see who else is here", async () => {
    await adminQuery(
      "INSERT INTO trip_collaborators (trip_id, user_id, role, invited_by) VALUES ($1,$2,'viewer',$3)",
      [tripId, friend.id, owner.id],
    );
    await markPresent(owner);

    const response = await presence(friend);

    // trip_presence_read is USING app.can_read_trip(trip_id), so this works
    // without the query filtering by anything.
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { viewers: unknown[] } }>().data.viewers).toHaveLength(1);
  });

  it("requires authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}/presence`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("is never cached", async () => {
    const response = await presence(owner);

    // Presence is stale the moment it is sent.
    expect(String(response.headers["cache-control"])).toContain("no-store");
  });
});
