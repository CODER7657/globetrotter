import { z } from "zod";
import { CostBreakdownSchema, TripId, envelope } from "@globetrotter/contracts";
import { createCostService } from "./cost.service.js";
import { sendCached } from "../../core/http-cache.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only. One call, one document — @Hem60's entire budget panel.
 */
const costRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createCostService(app.withTx);

  app.get(
    "/trips/:tripId/cost",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Full cost breakdown for a trip",
        params: z.object({ tripId: TripId }),
        response: { 200: envelope(CostBreakdownSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const breakdown = await service.breakdown(userId, request.params.tripId);

      // private, not public: this is one user's spending. The ETag still
      // saves a payload when the panel re-fetches, but no shared cache may
      // hold it.
      return sendCached(request, reply, { data: breakdown }, "private, max-age=0, must-revalidate");
    },
  );
};

export default costRoutes;
