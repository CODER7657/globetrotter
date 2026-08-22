import { sql } from "kysely";
import type { Tx } from "../../db/plugin.js";

/**
 * SQL only. The catalogue is reference data: read-only to the API role
 * (005_rls) and not subject to RLS, so nothing here filters by identity.
 */

export interface SearchRow {
  kind: "city" | "activity";
  id: string;
  name: string;
  subtitle: string | null;
  country_code: string | null;
  cost_amount: string | null;
  currency: string | null;
  popularity: number | null;
  score: number;
  matched_by: string[];
}

export interface SearchParams {
  query: string;
  kind: string;
  country: string | null;
  region: string | null;
  category: number | null;
  maxCost: string | null;
  currency: string;
  limit: number;
  /** Keyset cursor: the (score, id) of the last row of the previous page. */
  afterScore: number | null;
  afterId: string | null;
}

/**
 * Straight pass-through to app.search_places — full-text and trigram fused
 * with RRF, entirely in Postgres.
 *
 * **No ranking logic in Node**, and none should be added: `score` is only
 * comparable between a city and an activity because a single query produced
 * both. Re-sorting here would silently break that.
 *
 * Paging is keyset on `(score, id)`, done inside the function. The id is part
 * of the cursor because RRF scores tie routinely — paging on score alone drops
 * or repeats rows at a page boundary.
 */
export async function searchPlaces(trx: Tx, params: SearchParams): Promise<SearchRow[]> {
  const result = await sql<SearchRow>`
    select kind, id, name, subtitle, country_code, cost_amount,
           currency, popularity, score, matched_by
      from app.search_places(
        ${params.query},
        ${params.kind},
        ${params.country}::char(2),
        ${params.region},
        ${params.category}::smallint,
        ${params.maxCost}::numeric,
        ${params.currency}::char(3),
        ${params.limit}::integer,
        ${params.afterScore}::double precision,
        ${params.afterId}::uuid
      )
  `.execute(trx);

  return result.rows;
}

/** Popular fallbacks, so a no-results screen is never a dead end. */
export async function popularCities(trx: Tx, limit: number): Promise<SearchRow[]> {
  const result = await sql<SearchRow>`
    select 'city'::text            as kind,
           id,
           name,
           admin_area              as subtitle,
           country_code,
           null::text              as cost_amount,
           null::text              as currency,
           popularity,
           0::double precision     as score,
           array['popular']::text[] as matched_by
      from cities
     order by popularity desc, name asc
     limit ${limit}
  `.execute(trx);

  return result.rows;
}

// ------------------------------------------------------------ catalogue ---

export interface CityRow {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  admin_area: string | null;
  latitude: string;
  longitude: string;
  timezone: string;
  population: number | null;
  popularity: number;
  summary: string | null;
  hero_image_url: string | null;
  best_months: number[];
}

export interface Cursor {
  key: string;
  id: string;
}

export interface ListCitiesInput {
  country: string | undefined;
  q: string | undefined;
  sort: "popularity" | "name";
  after: Cursor | undefined;
  limit: number;
}

/**
 * Keyset pagination on (sort key, id).
 *
 * The id tiebreaker is load-bearing. `popularity` is a smallint shared by many
 * cities, so ordering by it alone is not a total order — without the
 * tiebreaker a page boundary can repeat or skip rows.
 *
 * The predicate is written out as an explicit OR rather than a row-wise
 * `(a, b) < (x, y)` comparison, because row comparison assumes both columns
 * sort the same direction and popularity sorts DESC while id sorts ASC.
 */
export async function listCities(trx: Tx, input: ListCitiesInput): Promise<CityRow[]> {
  let query = trx
    .selectFrom("cities")
    .select([
      "id",
      "name",
      "slug",
      "country_code",
      "admin_area",
      "latitude",
      "longitude",
      "timezone",
      "population",
      "popularity",
      "summary",
      "hero_image_url",
      "best_months",
    ])
    .limit(input.limit + 1);

  if (input.country !== undefined) {
    query = query.where("country_code", "=", input.country.toUpperCase());
  }

  if (input.q !== undefined && input.q.length > 0) {
    // Prefix match so the index on name can be used for type-ahead.
    query = query.where("name", "ilike", `${input.q}%`);
  }

  if (input.sort === "name") {
    query = query.orderBy("name", "asc").orderBy("id", "asc");

    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(name > ${after.key} or (name = ${after.key} and id > ${after.id}::uuid))`,
      );
    }
  } else {
    query = query.orderBy("popularity", "desc").orderBy("id", "asc");

    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(popularity < ${after.key}::smallint
                      or (popularity = ${after.key}::smallint and id > ${after.id}::uuid))`,
      );
    }
  }

  return query.execute();
}

export interface CatalogueActivityRow {
  id: string;
  city_id: string;
  city_name: string;
  category_id: number;
  name: string;
  slug: string;
  description: string | null;
  duration_minutes: number;
  cost_amount: string;
  currency_code: string;
  rating: string | null;
  image_url: string | null;
  booking_required: boolean;
}

export interface ListActivitiesInput {
  cityId: string | undefined;
  category: number | undefined;
  maxCost: string | undefined;
  q: string | undefined;
  sort: "rating" | "cost" | "name";
  after: Cursor | undefined;
  limit: number;
}

export async function listCatalogueActivities(
  trx: Tx,
  input: ListActivitiesInput,
): Promise<CatalogueActivityRow[]> {
  let query = trx
    .selectFrom("activities")
    .innerJoin("cities", "cities.id", "activities.city_id")
    .select([
      "activities.id",
      "activities.city_id",
      "cities.name as city_name",
      "activities.category_id",
      "activities.name",
      "activities.slug",
      "activities.description",
      "activities.duration_minutes",
      "activities.cost_amount",
      "activities.currency_code",
      "activities.rating",
      "activities.image_url",
      "activities.booking_required",
    ])
    .limit(input.limit + 1);

  if (input.cityId !== undefined) {
    query = query.where("activities.city_id", "=", input.cityId);
  }
  if (input.category !== undefined) {
    query = query.where("activities.category_id", "=", input.category);
  }
  if (input.maxCost !== undefined) {
    query = query.where("activities.cost_amount", "<=", input.maxCost);
  }
  if (input.q !== undefined && input.q.length > 0) {
    query = query.where("activities.name", "ilike", `%${input.q}%`);
  }

  // rating is nullable, so DESC puts NULLs first in Postgres unless told
  // otherwise — NULLS LAST keeps unrated activities out of the front page.
  if (input.sort === "rating") {
    query = query.orderBy(sql`activities.rating desc nulls last`).orderBy("activities.id", "asc");

    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(activities.rating < ${after.key}::numeric
                      or activities.rating is null
                      or (activities.rating = ${after.key}::numeric
                          and activities.id > ${after.id}::uuid))`,
      );
    }
  } else if (input.sort === "cost") {
    query = query.orderBy("activities.cost_amount", "asc").orderBy("activities.id", "asc");

    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(activities.cost_amount > ${after.key}::numeric
                      or (activities.cost_amount = ${after.key}::numeric
                          and activities.id > ${after.id}::uuid))`,
      );
    }
  } else {
    query = query.orderBy("activities.name", "asc").orderBy("activities.id", "asc");

    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(activities.name > ${after.key}
                      or (activities.name = ${after.key} and activities.id > ${after.id}::uuid))`,
      );
    }
  }

  return query.execute();
}
