import { z } from "zod";
import { TripId } from "@globetrotter/contracts";
import { createSharingService } from "./sharing.service.js";
import {
  CopiedTripSchema,
  CopyTripBodySchema,
  OpenGraphSchema,
  PublicTripSchema,
  ShareSlugSchema,
  ShareTripBodySchema,
  TripShareSchema,
  envelope,
} from "./sharing.schema.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Config } from "../../config.js";

/**
 * HTTP only.
 *
 * `/public/*` is the only unauthenticated surface in the API. It carries no
 * `preHandler: app.authenticate`, by design — possession of the slug is the
 * credential, and the database decides what that unlocks.
 */
const sharingRoutes: FastifyPluginAsyncZod<{ config: Config }> = async (app, opts) => {
  const service = createSharingService(app.withTx, app.withShareTx, opts.config.APP_BASE_URL);

  const TripParams = z.object({ tripId: TripId });
  const SlugParams = z.object({ slug: ShareSlugSchema });

  app.post(
    "/trips/:tripId/share",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["sharing"],
        summary: "Publish a trip and return its shareable link",
        params: TripParams,
        body: ShareTripBodySchema,
        response: { 200: envelope(TripShareSchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      const share = await service.share(
        userId,
        request.params.tripId,
        request.body.visibility,
      );

      return { data: share };
    },
  );

  app.delete(
    "/trips/:tripId/share",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["sharing"],
        summary: "Revoke every link and return the trip to private",
        params: TripParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      await service.revoke(userId, request.params.tripId);

      return reply.status(204).send(null);
    },
  );

  app.post(
    "/trips/:tripId/copy",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["sharing"],
        summary: "Deep-clone a trip you can see into one you own",
        params: TripParams,
        body: CopyTripBodySchema,
        response: { 201: envelope(CopiedTripSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const copied = await service.copy(userId, request.params.tripId, request.body.name);

      return reply
        .status(201)
        .header("location", `/api/v1/trips/${copied.id}`)
        .send({ data: copied });
    },
  );

  app.get(
    "/public/:slug",
    {
      schema: {
        tags: ["sharing"],
        summary: "Read a shared itinerary — no authentication",
        params: SlugParams,
        response: { 200: envelope(PublicTripSchema) },
      },
    },
    async (request, reply) => {
      const trip = await service.getPublic(request.params.slug);

      // Shared links get hit repeatedly from previews and social crawlers.
      return reply
        .header("cache-control", "public, max-age=60")
        .send({ data: trip });
    },
  );

  app.get(
    "/public/:slug/og",
    {
      schema: {
        tags: ["sharing"],
        summary: "Open Graph metadata for link previews",
        params: SlugParams,
        response: { 200: envelope(OpenGraphSchema) },
      },
    },
    async (request, reply) => {
      const og = await service.openGraph(request.params.slug);

      return reply
        .header("cache-control", "public, max-age=300")
        .send({ data: og });
    },
  );
};

export default sharingRoutes;
