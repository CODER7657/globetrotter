import {
  CursorQuerySchema,
  TripSummarySchema,
  paginated,
} from "@globetrotter/contracts";
import { createSummaryService } from "./summary.service.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only.
 *
 * Registered BEFORE /trips/:tripId would matter if Fastify matched in
 * declaration order — it does not, static segments beat parametric ones, so
 * /trips/summary cannot be swallowed by the id route.
 */
const summaryRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createSummaryService(app.withTx);

  app.get(
    "/trips/summary",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Headline totals for every trip the caller can see",
        querystring: CursorQuerySchema,
        response: { 200: paginated(TripSummarySchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return service.list(userId, request.query);
    },
  );
};

export default summaryRoutes;
