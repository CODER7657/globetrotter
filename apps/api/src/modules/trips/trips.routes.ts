import { z } from "zod";
import { TripId } from "@globetrotter/contracts";
import { parseIfMatch } from "../../core/concurrency.js";
import { createTripsService } from "./trips.service.js";
import {
  CreateTripBodySchema,
  CursorQuerySchema,
  TripSchema,
  UpdateTripBodySchema,
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

  app.patch(
    "/trips/:tripId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Partially update a trip (JSON Merge Patch)",
        description:
          "Send `If-Match` with the version from a previous ETag to make the write " +
          "conditional. A mismatch returns 409 with the current server state.",
        params: TripParamsSchema,
        body: UpdateTripBodySchema,
        response: { 200: envelope(TripSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const expected = parseIfMatch(request.headers["if-match"]);

      const trip = await service.update(userId, request.params.tripId, request.body, expected);

      return reply.header("etag", `"${trip.version}"`).send({ data: trip });
    },
  );

  app.delete(
    "/trips/:tripId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Soft-delete a trip",
        description: "Honours `If-Match` the same way as PATCH.",
        params: TripParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const expected = parseIfMatch(request.headers["if-match"]);

      await service.remove(userId, request.params.tripId, expected);

      return reply.status(204).send(null);
    },
  );
};

export default tripsRoutes;
