import { z } from "zod";
import { TripId, TripPresenceSchema, envelope } from "@globetrotter/contracts";
import { createPresenceService } from "./presence.service.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only.
 *
 * The READ side of presence. Writes belong to the WebSocket layer, which
 * already handles join, heartbeat and close — a REST heartbeat would be a
 * second source of truth for the same fact.
 */
const presenceRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createPresenceService(app.withTx);

  app.get(
    "/trips/:tripId/presence",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Who is viewing this trip right now",
        description:
          "Grouped by person, not by connection. Written by the WebSocket layer; " +
          "this is a read for clients that have no socket open yet.",
        params: z.object({ tripId: TripId }),
        response: { 200: envelope(TripPresenceSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const presence = await service.forTrip(userId, request.params.tripId);

      // Never cached, at any layer. Presence is stale the moment it is sent,
      // and a cached avatar bar showing someone who left is worse than none.
      return reply
        .header("cache-control", "no-store")
        .send({ data: presence });
    },
  );
};

export default presenceRoutes;
