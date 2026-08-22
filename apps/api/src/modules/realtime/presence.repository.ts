import { sql } from "kysely";
import type { Tx } from "../../db/plugin.js";

/**
 * SQL only.
 *
 * `trip_presence_read` is `USING app.can_read_trip(trip_id)`, so a caller who
 * cannot see the trip gets an empty list without this file filtering anything.
 */

export interface PresentUserRow {
  user_id: string;
  connections: number;
  last_seen: Date;
}

/**
 * Who is currently on a trip, grouped by person rather than by connection.
 *
 * Filters on `last_seen` instead of calling `app.reap_stale_presence`.
 *
 * The reaper deletes, and this is a GET: a safe method must not mutate, or a
 * browser prefetch and a bot crawl start silently disconnecting people. The
 * WebSocket layer already reaps on connect, so rows do not accumulate — this
 * read simply declines to believe stale ones.
 */
export async function listPresence(
  trx: Tx,
  tripId: string,
  staleAfterSeconds: number,
): Promise<PresentUserRow[]> {
  const result = await sql<PresentUserRow>`
    select user_id,
           count(*)::int  as connections,
           max(last_seen) as last_seen
      from trip_presence
     where trip_id = ${tripId}::uuid
       and last_seen > now() - make_interval(secs => ${staleAfterSeconds}::int)
     group by user_id
     order by max(last_seen) desc
  `.execute(trx);

  return result.rows;
}
