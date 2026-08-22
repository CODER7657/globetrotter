import { createSearchService } from "./search.service.js";
import { sendCached } from "../../core/http-cache.js";
import {
  ActivityQuerySchema,
  CatalogueActivitySchema,
  CityQuerySchema,
  CitySchema,
  SearchQuerySchema,
  SearchResultSchema,
  envelope,
  paginated,
} from "./search.schema.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only.
 *
 * These routes are unauthenticated: the catalogue is public reference data,
 * identical for every caller. That is what makes the shared `Cache-Control`
 * below safe — nothing here varies by identity, so a shared cache cannot
 * serve one user's view to another.
 */

/** Catalogue rows change only when @CODER7657 reseeds, so cache generously. */
const CATALOGUE_CACHE = "public, max-age=300";

/** Search is derived from the same data but far more query-diverse. */
const SEARCH_CACHE = "public, max-age=60";

const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createSearchService(app.withTx);

  app.get(
    "/search",
    {
      schema: {
        tags: ["search"],
        summary: "Hybrid search across cities and activities",
        querystring: SearchQuerySchema,
        response: { 200: envelope(SearchResultSchema) },
      },
    },
    async (request, reply) => {
      const result = await service.search(request.query);

      return sendCached(request, reply, { data: result }, SEARCH_CACHE);
    },
  );

  app.get(
    "/cities",
    {
      schema: {
        tags: ["search"],
        summary: "Browse the city catalogue",
        querystring: CityQuerySchema,
        response: { 200: paginated(CitySchema) },
      },
    },
    async (request, reply) => {
      const page = await service.cities(request.query);

      return sendCached(request, reply, page, CATALOGUE_CACHE);
    },
  );

  app.get(
    "/activities",
    {
      schema: {
        tags: ["search"],
        summary: "Browse the activity catalogue",
        querystring: ActivityQuerySchema,
        response: { 200: paginated(CatalogueActivitySchema) },
      },
    },
    async (request, reply) => {
      const page = await service.activities(request.query);

      return sendCached(request, reply, page, CATALOGUE_CACHE);
    },
  );
};

export default searchRoutes;
