import { randomUUID } from "node:crypto";
import websocket from "@fastify/websocket";
import { sql } from "kysely";
import { z } from "zod";
import { createTripListener } from "./realtime.listener.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { Config } from "../../config.js";
import type { TripListener } from "./realtime.listener.js";

/**
 * Collaborative editing transport (issue #7).
 *
 * AUTHENTICATION IS THE FIRST MESSAGE, NOT A QUERY PARAMETER.
 *
 * A browser cannot set an Authorization header on a WebSocket handshake, so the
 * usual shortcut is `?token=...`. We do not do that: query strings land in
 * access logs, proxy logs, and browser history, which is exactly where an
 * access token must never be. Instead the socket opens unauthenticated, is
 * allowed AUTH_TIMEOUT_MS to send one `{type:"auth"}` frame, and is closed
 * otherwise. Nothing is subscribed and nothing is sent before that succeeds.
 */

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 25_000;
const PRESENCE_TTL = "90 seconds";

const ClientFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(1) }),
  z.object({ type: z.literal("ping") }),
]);

const ParamsSchema = z.object({ tripId: z.string().uuid() });

/** Close codes. 4401/4403/4404 are application codes in the private range. */
const CLOSE = {
  UNAUTHENTICATED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  BAD_FRAME: 4400,
} as const;

export default async function realtimeRoutes(
  app: FastifyInstance,
  opts: { config: Config },
): Promise<void> {
  await app.register(websocket, {
    options: {
      maxPayload: 16 * 1024,
      // Reject an upgrade whose Origin we do not recognise. WebSockets are NOT
      // covered by CORS, so without this any page on the internet could open a
      // socket against this API using the visitor's cookies.
      verifyClient: ({ origin }, done) => {
        done(origin === undefined || opts.config.CORS_ORIGINS.includes(origin));
      },
    },
  });

  const listener: TripListener = createTripListener(opts.config.APP_DATABASE_URL, app.log);
  app.addHook("onClose", async () => {
    await listener.close();
  });

  // Sweep connections that vanished without a clean close — a shut laptop lid
  // never sends a close frame, and a ghost avatar in the presence bar is worse
  // than no presence bar.
  const reaper = setInterval(() => {
    void app
      .withTx(null, async (trx) =>
        sql`SELECT app.reap_stale_presence(${PRESENCE_TTL}::interval)`.execute(trx),
      )
      .catch((error: unknown) => app.log.warn({ err: error }, "presence reap failed"));
  }, 30_000);
  reaper.unref();
  app.addHook("onClose", async () => {
    clearInterval(reaper);
  });

  app.get(
    "/trips/:tripId/live",
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) {
        socket.close(CLOSE.BAD_FRAME, "bad trip id");
        return;
      }
      const tripId = params.data.tripId;
      const connectionId = randomUUID();

      let userId: string | undefined;
      let unsubscribe: (() => Promise<void>) | undefined;
      let heartbeat: NodeJS.Timeout | undefined;

      const authTimer = setTimeout(() => {
        if (userId === undefined) socket.close(CLOSE.UNAUTHENTICATED, "auth timeout");
      }, AUTH_TIMEOUT_MS);

      const send = (payload: unknown): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
      };

      const cleanup = async (): Promise<void> => {
        clearTimeout(authTimer);
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (unsubscribe !== undefined) await unsubscribe().catch(() => undefined);
        if (userId !== undefined) {
          await app
            .withTx(userId, async (trx) =>
              trx.deleteFrom("trip_presence").where("connection", "=", connectionId).execute(),
            )
            .catch(() => undefined);
        }
      };

      socket.on("message", (raw: Buffer) => {
        void (async () => {
          const frame = ClientFrame.safeParse(safeJson(raw.toString("utf8")));
          if (!frame.success) {
            socket.close(CLOSE.BAD_FRAME, "unrecognised frame");
            return;
          }

          if (frame.data.type === "ping") {
            send({ type: "pong" });
            return;
          }

          if (userId !== undefined) return; // already authenticated; ignore re-auth

          let claims;
          try {
            claims = await app.tokens.verify(frame.data.token);
          } catch {
            socket.close(CLOSE.UNAUTHENTICATED, "invalid token");
            return;
          }

          // Authorisation is the database's answer, not ours. can_read_trip is
          // the same predicate the RLS policies use, so a socket can never see
          // a trip the REST API would hide.
          const readable = await app.withTx(claims.userId, async (trx) => {
            const row = await sql<{ ok: boolean }>`
              SELECT app.can_read_trip(${tripId}::uuid) AS ok
            `.execute(trx);
            return row.rows[0]?.ok ?? false;
          });

          if (!readable) {
            // 4404, not 4403: existence itself is not disclosed, matching the
            // REST behaviour where a hidden trip is a 404.
            socket.close(CLOSE.NOT_FOUND, "no such trip");
            return;
          }

          userId = claims.userId;
          clearTimeout(authTimer);

          await app.withTx(userId, async (trx) => {
            await trx
              .insertInto("trip_presence")
              .values({ trip_id: tripId, user_id: userId!, connection: connectionId })
              .onConflict((oc) =>
                oc.columns(["trip_id", "connection"]).doUpdateSet({ last_seen: sql`now()` }),
              )
              .execute();
          });

          unsubscribe = await listener.subscribe(tripId, (event) => {
            send({ type: "trip.changed", ...event });
          });

          send({ type: "ready", tripId, connectionId });

          heartbeat = setInterval(() => {
            if (socket.readyState !== socket.OPEN) return;
            socket.ping();
            void app
              .withTx(userId!, async (trx) =>
                trx
                  .updateTable("trip_presence")
                  .set({ last_seen: sql`now()` })
                  .where("connection", "=", connectionId)
                  .execute(),
              )
              .catch(() => undefined);
          }, HEARTBEAT_MS);
        })().catch((error: unknown) => {
          app.log.error({ err: error }, "realtime frame handling failed");
          socket.close(1011, "internal error");
        });
      });

      socket.on("close", () => void cleanup());
      socket.on("error", (error) => {
        app.log.warn({ err: error }, "realtime socket errored");
        void cleanup();
      });
    },
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
