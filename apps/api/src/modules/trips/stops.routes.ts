import { z } from "zod";
import { StopId, TripId } from "@globetrotter/contracts";
import { createStopsService } from "./stops.service.js";
import {
  CreateStopBodySchema,
  ReorderStopsBodySchema,
  TripStopSchema,
  UpdateStopBodySchema,
  envelope,
} from "./trips.schema.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only. Stops hang off a trip, so every route is nested under it and the
 * trip id is what authorization is resolved against.
 */
const stopsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createStopsService(app.withTx);

  const TripParams = z.object({ tripId: TripId });
  const StopParams = z.object({ stopId: StopId });
  const StopList = z.object({ data: z.array(TripStopSchema) });

  app.get(
    "/trips/:tripId/stops",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["stops"],
        summary: "List a trip's stops in visiting order",
        params: TripParams,
        response: { 200: StopList },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return { data: await service.list(userId, request.params.tripId) };
    },
  );

  app.post(
    "/trips/:tripId/stops",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["stops"],
        summary: "Append a stop to a trip",
        params: TripParams,
        body: CreateStopBodySchema,
        response: { 201: envelope(TripStopSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const stop = await service.create(userId, request.params.tripId, request.body);

      return reply
        .status(201)
        .header("location", `/api/v1/stops/${stop.id}`)
        .send({ data: stop });
    },
  );

  app.patch(
    "/stops/:stopId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["stops"],
        summary: "Partially update a stop (JSON Merge Patch)",
        params: StopParams,
        body: UpdateStopBodySchema,
        response: { 200: envelope(TripStopSchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return { data: await service.update(userId, request.params.stopId, request.body) };
    },
  );

  app.delete(
    "/stops/:stopId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["stops"],
        summary: "Remove a stop and everything scheduled inside it",
        params: StopParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      await service.remove(userId, request.params.stopId);

      return reply.status(204).send(null);
    },
  );

  app.put(
    "/trips/:tripId/stops/order",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["stops"],
        summary: "Reorder every stop in one transaction",
        params: TripParams,
        body: ReorderStopsBodySchema,
        response: { 200: StopList },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      const stops = await service.reorder(
        userId,
        request.params.tripId,
        request.body.stopIds,
      );

      return { data: stops };
    },
  );
};

export default stopsRoutes;
