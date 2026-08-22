import {
  AdminMetricsQuerySchema,
  AdminMetricsSchema,
  AdminUserQuerySchema,
  AdminUserSchema,
  envelope,
  paginated,
} from "@globetrotter/contracts";
import { createAdminService } from "./admin.service.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only.
 *
 * `requireAdmin` is the outer gate, but it is not the only one: every policy
 * these queries touch ends in `OR app.is_admin()`, so a non-admin transaction
 * would see just its own rows. Remove the guard and the endpoints degrade to
 * useless rather than to a breach — defence in depth, with the database
 * having the final say as everywhere else.
 */
const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createAdminService(app.withTx);

  app.get(
    "/admin/metrics",
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Platform metrics: totals, trips over time, top cities and activities, DAU/WAU",
        querystring: AdminMetricsQuerySchema,
        response: { 200: envelope(AdminMetricsSchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return { data: await service.metrics(userId, request.query) };
    },
  );

  app.get(
    "/admin/users",
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Search, sort and page through accounts",
        querystring: AdminUserQuerySchema,
        response: { 200: paginated(AdminUserSchema) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return service.users(userId, request.query);
    },
  );
};

export default adminRoutes;
