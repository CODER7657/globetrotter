import { sql } from "kysely";
import type { Tx } from "../../db/plugin.js";
import type { UserRole } from "../../db/types.js";

/**
 * SQL only.
 *
 * Nothing here filters by identity, and that is not an oversight. Every
 * relevant policy already ends in `OR app.is_admin()` — `users_self_read`,
 * `can_read_trip` — so an admin transaction sees everything and a
 * non-admin one sees only their own rows.
 *
 * The consequence worth stating: if the route guard were removed, these
 * queries would return a caller's own data rather than everyone's. They
 * degrade to useless, not to a breach.
 */

export interface TotalsRow {
  users: number;
  trips: number;
  stops: number;
  activities: number;
}

export async function totals(trx: Tx): Promise<TotalsRow> {
  const result = await sql<TotalsRow>`
    select (select count(*)::int from users where deleted_at is null)  as users,
           (select count(*)::int from trips where deleted_at is null)  as trips,
           (select count(*)::int from trip_stops)                      as stops,
           (select count(*)::int from trip_activities)                 as activities
  `.execute(trx);

  return result.rows[0] ?? { users: 0, trips: 0, stops: 0, activities: 0 };
}

export interface CountByDayRow {
  day: string;
  count: number;
}

/**
 * Trips created per day.
 *
 * generate_series supplies the zero days. Without it a quiet Tuesday is
 * absent rather than zero, and a line chart drawn from that silently joins
 * Monday to Wednesday as though nothing happened in between.
 */
export async function tripsOverTime(trx: Tx, days: number): Promise<CountByDayRow[]> {
  const result = await sql<CountByDayRow>`
    with span as (
      select generate_series(
        (current_date - make_interval(days => ${days}::int - 1)),
        current_date,
        interval '1 day'
      )::date as day
    )
    select to_char(span.day, 'YYYY-MM-DD') as day,
           count(t.id)::int                as count
      from span
      left join trips t
        on t.created_at::date = span.day
       and t.deleted_at is null
     group by span.day
     order by span.day
  `.execute(trx);

  return result.rows;
}

export interface TopCityRow {
  city_id: string;
  name: string;
  country_code: string;
  trip_count: number;
}

/** Distinct trips per city — a trip with three stops in Paris counts once. */
export async function topCities(trx: Tx, limit: number): Promise<TopCityRow[]> {
  const result = await sql<TopCityRow>`
    select c.id                            as city_id,
           c.name,
           c.country_code,
           count(distinct s.trip_id)::int  as trip_count
      from trip_stops s
      join cities c on c.id = s.city_id
      join trips t  on t.id = s.trip_id and t.deleted_at is null
     group by c.id, c.name, c.country_code
     order by trip_count desc, c.name asc
     limit ${limit}
  `.execute(trx);

  return result.rows;
}

export interface TopActivityRow {
  activity_id: string;
  name: string;
  scheduled_count: number;
}

/**
 * Only catalogue-backed activities. A freeform entry has a null activity_id
 * and no shared identity, so counting those would group unrelated titles.
 */
export async function topActivities(trx: Tx, limit: number): Promise<TopActivityRow[]> {
  const result = await sql<TopActivityRow>`
    select a.id           as activity_id,
           a.name,
           count(*)::int  as scheduled_count
      from trip_activities ta
      join activities a  on a.id = ta.activity_id
      join trip_stops s  on s.id = ta.stop_id
      join trips t       on t.id = s.trip_id and t.deleted_at is null
     group by a.id, a.name
     order by scheduled_count desc, a.name asc
     limit ${limit}
  `.execute(trx);

  return result.rows;
}

export interface AveragesRow {
  trip_length_days: number | null;
  budget: string | null;
  stops_per_trip: number | null;
}

export async function averages(trx: Tx): Promise<AveragesRow> {
  const result = await sql<AveragesRow>`
    select avg(upper(t.period) - lower(t.period))::double precision as trip_length_days,
           -- Averaged over trips that SET a budget. Including the others as
           -- zero would report a fleet-wide budget that nobody chose.
           round(avg(t.budget_cap) filter (where t.budget_cap is not null), 2)::text as budget,
           (select avg(n)::double precision
              from (select count(*) as n
                      from trip_stops s
                      join trips t2 on t2.id = s.trip_id and t2.deleted_at is null
                     group by s.trip_id) x)                          as stops_per_trip
      from trips t
     where t.deleted_at is null
  `.execute(trx);

  return result.rows[0] ?? { trip_length_days: null, budget: null, stops_per_trip: null };
}

export interface EngagementRow {
  dau: number;
  wau: number;
}

export async function engagement(trx: Tx): Promise<EngagementRow> {
  const result = await sql<EngagementRow>`
    select count(*) filter (where last_login_at >= now() - interval '1 day')::int  as dau,
           count(*) filter (where last_login_at >= now() - interval '7 days')::int as wau
      from users
     where deleted_at is null
  `.execute(trx);

  return result.rows[0] ?? { dau: 0, wau: 0 };
}

// ------------------------------------------------------------- users ------

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  home_currency: string;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
  /** Kysely types a correlated subquery as nullable; count(*) never is. */
  trip_count: number | null;
}

export interface ListUsersInput {
  q: string | undefined;
  role: UserRole | undefined;
  includeSuspended: boolean;
  sort: "createdAt" | "lastLoginAt" | "email";
  after: { key: string; id: string } | undefined;
  limit: number;
}

/**
 * Keyset paginated, with the id as tiebreaker for the same reason as
 * everywhere else: `created_at` and `last_login_at` are not unique, so
 * ordering on them alone is not a total order.
 */
export async function listUsers(trx: Tx, input: ListUsersInput): Promise<AdminUserRow[]> {
  let query = trx
    .selectFrom("users")
    .select((eb) => [
      "users.id",
      "users.email",
      "users.display_name",
      "users.role",
      "users.home_currency",
      "users.email_verified_at",
      "users.last_login_at",
      "users.created_at",
      "users.deleted_at",
      eb
        .selectFrom("trips")
        .select(sql<number>`count(*)::int`.as("c"))
        .whereRef("trips.owner_id", "=", "users.id")
        .where("trips.deleted_at", "is", null)
        .as("trip_count"),
    ])
    .limit(input.limit + 1);

  if (!input.includeSuspended) {
    query = query.where("users.deleted_at", "is", null);
  }
  if (input.role !== undefined) {
    query = query.where("users.role", "=", input.role);
  }
  if (input.q !== undefined && input.q.length > 0) {
    const term = `%${input.q}%`;
    query = query.where((eb) =>
      eb.or([eb("users.email", "ilike", term), eb("users.display_name", "ilike", term)]),
    );
  }

  if (input.sort === "email") {
    query = query.orderBy("users.email", "asc").orderBy("users.id", "asc");
    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(users.email > ${after.key}::citext
                      or (users.email = ${after.key}::citext and users.id > ${after.id}::uuid))`,
      );
    }
  } else if (input.sort === "lastLoginAt") {
    // NULLS LAST: an account that has never signed in should not head a list
    // sorted by recency.
    query = query
      .orderBy(sql`users.last_login_at desc nulls last`)
      .orderBy("users.id", "asc");
    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(users.last_login_at < ${after.key}::timestamptz
                      or users.last_login_at is null
                      or (users.last_login_at = ${after.key}::timestamptz
                          and users.id > ${after.id}::uuid))`,
      );
    }
  } else {
    query = query.orderBy("users.created_at", "desc").orderBy("users.id", "asc");
    if (input.after !== undefined) {
      const after = input.after;
      query = query.where(
        sql<boolean>`(users.created_at < ${after.key}::timestamptz
                      or (users.created_at = ${after.key}::timestamptz
                          and users.id > ${after.id}::uuid))`,
      );
    }
  }

  return query.execute();
}
