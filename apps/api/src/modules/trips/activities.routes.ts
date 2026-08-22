import { z } from "zod";
import { StopId, TripActivityId } from "@globetrotter/contracts";
import { createActivitiesService } from "./activities.service.js";
import {
  CreateTripActivityBodySchema,
  TripActivitySchema,
  UpdateTripActivityBodySchema,
  envelope,
} from "./trips.schema.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only.
 *
 * The path is `/trip-activities/:id`, not `/activities/:id`: the catalogue
 * lives at `/activities` (#19), and two different resources answering to the
 * same noun is how a client ends up scheduling a city.
 */
const activitiesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createActivitiesService(app.withTx);

  const StopParams = z.object({ stopId: StopId });
  const ActivityParams = z.object({ tripActivityId: TripActivityId });
  const ActivityList = z.object({ data: z.array(TripActivitySchema) });

  app.get(
    "/stops/:stopId/activities",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["activities"],
        summary: "List what is scheduled inside a stop, earliest first",
        params: StopParams,
        response: { 200: ActivityList },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return { data: await service.list(userId, request.params.stopId) };
    },
  );

  app.post(
    "/stops/:stopId/activities",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["activities"],
        summary: "Schedule an activity inside a stop",
        params: StopParams,
        body: CreateTripActivityBodySchema,
        response: { 201: envelope(TripActivitySchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const activity = await service.create(userId, request.params.stopId, request.body);

      return reply
        .status(201)
        .header("location", `/api/v1/trip-activities/${activity.id}`)
        .send({ data: activity });
    },
  );

  app.patch(
    "/trip-activities/:tripActivityId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["activities"],
        summary: "Partially update a scheduled activity (JSON Merge Patch)",
        params: ActivityParams,
        body: UpdateTripActivityBodySchema,
        response: { 200: envelope(TripActivitySchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      const activity = await service.update(
        userId,
        request.params.tripActivityId,
        request.body,
      );

      return { data: activity };
    },
  );

  app.delete(
    "/trip-activities/:tripActivityId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["activities"],
        summary: "Unschedule an activity",
        params: ActivityParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      await service.remove(userId, request.params.tripActivityId);

      return reply.status(204).send(null);
    },
  );
};

export default activitiesRoutes;
