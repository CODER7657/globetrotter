/**
 * Re-export only — shapes live in packages/contracts (issue #14).
 */
export {
  ActivityQuerySchema,
  CatalogueActivitySchema,
  CityQuerySchema,
  CitySchema,
  FxRateSchema,
  SearchQuerySchema,
  SearchResultSchema,
  envelope,
  paginated,
} from "@globetrotter/contracts";

export type {
  ActivityQuery,
  CatalogueActivity,
  City,
  CityQuery,
  SearchQuery,
  SearchResult,
} from "@globetrotter/contracts";
