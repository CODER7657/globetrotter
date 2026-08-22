import pg from "pg";
import { z } from "zod";
import type { FastifyBaseLogger } from "fastify";

/**
 * The bridge between Postgres LISTEN/NOTIFY and the WebSocket rooms.
 *
 * ONE dedicated connection, not a pooled one. A pooled client would hand the
 * connection back after each query and the LISTEN registration would go with
 * it — notifications would silently stop arriving. This is the single most
 * common way LISTEN/NOTIFY is got wrong, so it is deliberately a `pg.Client`
 * and never a `pg.Pool`.
 *
 * The connection is also intentionally NOT the RLS-bound app role: it only ever
 * relays ids, never row data, and clients refetch through the authorized API.
 * See the comment on app.notify_trip_change in migration 009.
 */

/** Mirrors the payload built by app.notify_trip_change(). */
export const TripEventSchema = z.object({
  trip: z.string().uuid(),
  entity: z.enum(["trip", "stop", "activity"]),
  op: z.enum(["INSERT", "UPDATE", "DELETE"]),
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  actor: z.string().uuid().nullable(),
  at: z.string(),
});
export type TripEvent = z.infer<typeof TripEventSchema>;

export type TripEventHandler = (event: TripEvent) => void;

export function tripChannel(tripId: string): string {
  return `gt_trip_${tripId.replaceAll("-", "")}`;
}

export interface TripListener {
  subscribe: (tripId: string, handler: TripEventHandler) => Promise<() => Promise<void>>;
  close: () => Promise<void>;
  /** Test seam: how many channels currently have at least one subscriber. */
  channelCount: () => number;
}

export function createTripListener(
  connectionString: string,
  log: FastifyBaseLogger,
): TripListener {
  const handlers = new Map<string, Set<TripEventHandler>>();
  let client: pg.Client | undefined;
  let connecting: Promise<pg.Client> | undefined;
  let closed = false;
  let backoffMs = 250;

  async function connect(): Promise<pg.Client> {
    const c = new pg.Client({ connectionString });

    c.on("notification", (msg) => {
      const set = handlers.get(msg.channel);
      if (set === undefined || msg.payload === undefined) return;

      const parsed = TripEventSchema.safeParse(safeJson(msg.payload));
      if (!parsed.success) {
        // A malformed payload means the trigger and this schema have drifted.
        // Log loudly rather than dropping it silently.
        log.error({ channel: msg.channel, payload: msg.payload }, "unparseable trip event");
        return;
      }

      for (const handler of set) {
        try {
          handler(parsed.data);
        } catch (error) {
          log.error({ err: error }, "trip event handler threw");
        }
      }
    });

    c.on("error", (error) => {
      log.error({ err: error }, "listener connection errored");
      void reconnect();
    });

    await c.connect();
    backoffMs = 250;
    return c;
  }

  /**
   * On reconnect every channel must be re-registered: LISTEN lives on the
   * connection, so a dropped connection silently unsubscribes everyone. Without
   * this the app looks fine and simply stops updating.
   */
  async function reconnect(): Promise<void> {
    if (closed) return;

    client = undefined;
    connecting = undefined;

    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, 10_000);

    await new Promise((resolve) => setTimeout(resolve, delay));
    if (closed) return;

    try {
      const c = await ensureClient();
      for (const channel of handlers.keys()) {
        await c.query(`LISTEN ${quoteIdent(channel)}`);
      }
      log.info({ channels: handlers.size }, "listener reconnected and re-subscribed");
    } catch (error) {
      log.error({ err: error }, "listener reconnect failed");
      void reconnect();
    }
  }

  async function ensureClient(): Promise<pg.Client> {
    if (client !== undefined) return client;
    connecting ??= connect().then((c) => {
      client = c;
      return c;
    });
    return connecting;
  }

  async function subscribe(
    tripId: string,
    handler: TripEventHandler,
  ): Promise<() => Promise<void>> {
    const channel = tripChannel(tripId);
    const c = await ensureClient();

    let set = handlers.get(channel);
    if (set === undefined) {
      set = new Set();
      handlers.set(channel, set);
      await c.query(`LISTEN ${quoteIdent(channel)}`);
    }
    set.add(handler);

    return async () => {
      const current = handlers.get(channel);
      if (current === undefined) return;

      current.delete(handler);
      if (current.size > 0) return;

      // Last subscriber for this trip left — stop carrying the channel.
      handlers.delete(channel);
      if (client !== undefined && !closed) {
        try {
          await client.query(`UNLISTEN ${quoteIdent(channel)}`);
        } catch (error) {
          log.warn({ err: error, channel }, "UNLISTEN failed");
        }
      }
    };
  }

  return {
    subscribe,
    channelCount: () => handlers.size,
    close: async () => {
      closed = true;
      handlers.clear();
      const c = client;
      client = undefined;
      connecting = undefined;
      if (c !== undefined) await c.end();
    },
  };
}

/**
 * Channel names come from app.trip_channel(), which strips hyphens from a uuid
 * — so they are already `[a-z0-9_]`. Quoting anyway because a LISTEN target is
 * an identifier and string-building an identifier without quoting is a habit
 * worth not having.
 */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
