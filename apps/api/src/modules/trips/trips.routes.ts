import { z } from "zod";
import { TripId } from "@globetrotter/contracts";
import { createTripsService } from "./trips.service.js";
import {
  CreateTripBodySchema,
  CursorQuerySchema,
  TripSchema,
  envelope,
  paginated,
} from "./trips.schema.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only — parse the request, call the service, choose a status code.
 * No business logic, no SQL. A route importing a repository is a lint error.
 *
 * Registered as an encapsulated plugin, so hooks added here (auth, rate
 * limits) apply to this module and leak nowhere else.
 */
const tripsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createTripsService(app.withTx);

  const TripParamsSchema = z.object({ tripId: TripId });

  app.post(
    "/trips",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Create a trip",
        body: CreateTripBodySchema,
        response: { 201: envelope(TripSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const trip = await service.create(userId, request.body);

      return reply
        .status(201)
        .header("location", `/api/v1/trips/${trip.id}`)
        .send({ data: trip });
    },
  );

  app.get(
    "/trips",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "List the caller's trips, newest first",
        querystring: CursorQuerySchema,
        response: { 200: paginated(TripSchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return service.list(userId, request.query);
    },
  );

  app.get(
    "/trips/:tripId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Fetch one trip",
        params: TripParamsSchema,
        response: { 200: envelope(TripSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const trip = await service.getById(userId, request.params.tripId);

      // ETag carries the optimistic-concurrency version, so the client can
      // send it straight back as If-Match (issue #17).
      return reply.header("etag", `"${trip.version}"`).send({ data: trip });
    },
  );
};

export default tripsRoutes;
