import { z } from "zod";
import { ActivityId, CityId } from "./ids.js";
import { CurrencyCodeSchema, MoneyAmountSchema } from "./common.js";
import { PageInfoSchema } from "./pagination.js";

/**
 * Search and catalogue browsing (#66 item 2).
 *
 * `/search` is a pass-through over `app.search_places` — hybrid full-text +
 * trigram retrieval fused with RRF, entirely in Postgres. No ranking logic
 * exists in Node and none should be added: the score comes from the database
 * or it is not comparable across result kinds.
 */

export const SearchKindSchema = z.enum(["city", "activity"]);
export type SearchKind = z.infer<typeof SearchKindSchema>;

/**
 * Which signal matched — e.g. `["fulltext", "trigram"]`.
 *
 * Surfaced so the UI can build a "did you mean" affordance: a result that
 * matched only on trigram is a fuzzy hit worth confirming, whereas a
 * full-text hit is one the user probably meant.
 */
export const MatchedBySchema = z.array(z.string());

export const SearchHitSchema = z.object({
  kind: SearchKindSchema,
  id: z.string().uuid(),
  name: z.string(),
  subtitle: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  costAmount: MoneyAmountSchema.nullable(),
  currency: CurrencyCodeSchema.nullable(),
  popularity: z.number().int().nullable(),
  score: z.number(),
  matchedBy: MatchedBySchema,
});

export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().max(200).default(""),
  kind: z.enum(["all", "city", "activity"]).default("all"),
  country: z.string().length(2).optional(),
  region: z.string().max(80).optional(),
  category: z.coerce.number().int().positive().optional(),
  maxCost: MoneyAmountSchema.optional(),
  currency: CurrencyCodeSchema.optional(),
  /** Opaque keyset cursor from `page.nextCursor`. Never construct one. */
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultSchema = z.object({
  query: z.string(),
  hits: z.array(SearchHitSchema),
  /**
   * Keyset pagination over `(score, id)`.
   *
   * The id is part of the cursor because RRF scores tie routinely — paging on
   * score alone drops or repeats rows at a page boundary.
   */
  page: PageInfoSchema,
  /**
   * Populated only when `hits` is empty: popular fallbacks so the UI never
   * has to render a dead end. Suggestions are not paginated.
   */
  suggestions: z.array(SearchHitSchema),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

// ------------------------------------------------------------ catalogue ---

export const CitySchema = z.object({
  id: CityId,
  name: z.string(),
  slug: z.string(),
  countryCode: z.string().length(2),
  adminArea: z.string().nullable(),
  latitude: z.string(),
  longitude: z.string(),
  timezone: z.string(),
  population: z.number().int().nullable(),
  popularity: z.number().int(),
  summary: z.string().nullable(),
  heroImageUrl: z.string().nullable(),
  bestMonths: z.array(z.number().int()),
});

export type City = z.infer<typeof CitySchema>;

export const CityQuerySchema = z.object({
  country: z.string().length(2).optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(["popularity", "name"]).default("popularity"),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CityQuery = z.infer<typeof CityQuerySchema>;

export const CatalogueActivitySchema = z.object({
  id: ActivityId,
  cityId: CityId,
  cityName: z.string(),
  categoryId: z.number().int(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int(),
  costAmount: MoneyAmountSchema,
  currencyCode: CurrencyCodeSchema,
  rating: z.string().nullable(),
  imageUrl: z.string().nullable(),
  bookingRequired: z.boolean(),
});

export type CatalogueActivity = z.infer<typeof CatalogueActivitySchema>;

export const ActivityQuerySchema = z.object({
  cityId: CityId.optional(),
  category: z.coerce.number().int().positive().optional(),
  maxCost: MoneyAmountSchema.optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(["rating", "cost", "name"]).default("rating"),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
