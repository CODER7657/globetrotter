-- ============================================================================
-- 009_realtime — collaborative editing on Postgres LISTEN/NOTIFY
-- ============================================================================
-- No Pusher, no Firebase, no Socket.io cloud, no message broker. The database
-- already knows when a row changed; this makes it say so.
--
--   write → AFTER trigger → pg_notify('gt_trip_<id>') → one listener connection
--         → WebSocket fan-out to everyone in that trip room
--
-- Three design points that matter:
--
-- 1. IDS ONLY, NEVER ROW DATA. NOTIFY payloads are capped at 8000 bytes and a
--    trip name plus notes would blow that on a long itinerary. More
--    importantly, a payload carrying row data would bypass RLS — the listener
--    connection is not the requesting user, so it must not be the thing that
--    decides what anyone is allowed to see. Clients refetch through the normal
--    authorized API, where their own policies apply.
--
-- 2. ACTOR IS INCLUDED so a client can drop the echo of its own write instead
--    of clobbering the edit its user is still typing.
--
-- 3. NOTIFY IS TRANSACTIONAL. Postgres holds notifications until COMMIT, so a
--    rolled-back edit is never announced. That is a guarantee an application
--    level event bus has to work for and usually gets wrong.
-- ============================================================================

-- Channel names are quoted identifiers on the LISTEN side; stripping hyphens
-- keeps them simple and well under the 63-character limit.
CREATE FUNCTION app.trip_channel(p_trip uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'gt_trip_' || replace(p_trip::text, '-', '')
$$;

-- ------------------------------------------------------- version bumping ---
-- Every mutation anywhere in the trip graph advances trips.version. That single
-- integer is what the API compares against If-Match, so a stale client editing
-- a stop is caught even though it never touched the trips row.
CREATE FUNCTION app.bump_trip_version(p_trip uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE v integer;
BEGIN
  UPDATE trips SET version = version + 1, updated_at = now()
   WHERE id = p_trip
  RETURNING version INTO v;
  RETURN v;
END
$$;

REVOKE ALL ON FUNCTION app.bump_trip_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bump_trip_version(uuid) TO globetrotter_app;

-- ------------------------------------------------------------- the emitter --
CREATE FUNCTION app.notify_trip_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  v_trip    uuid;
  v_row     record;
  v_entity  text := TG_ARGV[0];
  v_version integer;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  -- Resolve the owning trip. Stops carry trip_id directly; activities reach it
  -- through their stop; the trips table is its own id.
  IF v_entity = 'trip' THEN
    v_trip := v_row.id;
  ELSIF v_entity = 'stop' THEN
    v_trip := v_row.trip_id;
  ELSE
    SELECT trip_id INTO v_trip FROM trip_stops WHERE id = v_row.stop_id;
  END IF;

  IF v_trip IS NULL THEN
    RETURN NULL;  -- parent already gone; the trip-level event covers it
  END IF;

  -- Suppress the echo of our own version bump.
  --
  -- Adding a stop fires this trigger, which calls bump_trip_version, which
  -- UPDATEs trips, which fires this trigger AGAIN as entity='trip'. Every graph
  -- edit would therefore emit TWO events and every client would refetch twice.
  --
  -- A trip UPDATE that touched nothing but version/updated_at carries no
  -- information the child event does not already carry — the child event
  -- includes the new version. So drop it.
  IF v_entity = 'trip' AND TG_OP = 'UPDATE'
     AND to_jsonb(OLD) - 'version' - 'updated_at'
       = to_jsonb(NEW) - 'version' - 'updated_at' THEN
    RETURN NULL;
  END IF;

  -- Bump for graph edits only. Doing it for 'trip' would recurse: the UPDATE
  -- would re-fire this same trigger.
  IF v_entity <> 'trip' THEN
    v_version := app.bump_trip_version(v_trip);
  ELSE
    v_version := v_row.version;
  END IF;

  PERFORM pg_notify(
    app.trip_channel(v_trip),
    jsonb_build_object(
      'trip',    v_trip,
      'entity',  v_entity,
      'op',      TG_OP,
      'id',      v_row.id,
      'version', v_version,
      -- NULL when the change came from a migration or an admin console rather
      -- than a request; clients treat that as "not mine, apply it".
      'actor',   app.current_user_id(),
      'at',      to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );

  RETURN NULL;  -- AFTER trigger; return value is ignored
END
$$;

COMMENT ON FUNCTION app.notify_trip_change IS
  'Emits ids only. A payload carrying row data would bypass RLS, because the listener '
  'connection is not the requesting user. Clients refetch through the authorized API.';

REVOKE ALL ON FUNCTION app.notify_trip_change() FROM PUBLIC;

-- ------------------------------------------------------------- the wiring --
CREATE TRIGGER trips_notify
  AFTER INSERT OR UPDATE OR DELETE ON trips
  FOR EACH ROW EXECUTE FUNCTION app.notify_trip_change('trip');

CREATE TRIGGER trip_stops_notify
  AFTER INSERT OR UPDATE OR DELETE ON trip_stops
  FOR EACH ROW EXECUTE FUNCTION app.notify_trip_change('stop');

CREATE TRIGGER trip_activities_notify
  AFTER INSERT OR UPDATE OR DELETE ON trip_activities
  FOR EACH ROW EXECUTE FUNCTION app.notify_trip_change('activity');

-- ------------------------------------------------------------- presence -----
-- Who is looking at this trip right now. UNLOGGED because it is ephemeral by
-- definition: if the server restarts, everyone reconnects and rebuilds it, and
-- there is no reason to pay WAL for that.
CREATE UNLOGGED TABLE trip_presence (
  trip_id    uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection uuid        NOT NULL,
  last_seen  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, connection)
);
CREATE INDEX trip_presence_seen_idx ON trip_presence (last_seen);

ALTER TABLE trip_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_presence FORCE  ROW LEVEL SECURITY;

-- You can see who else is here only if you can see the trip at all.
CREATE POLICY trip_presence_read ON trip_presence FOR SELECT
  USING (app.can_read_trip(trip_id));
CREATE POLICY trip_presence_write ON trip_presence FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id() AND app.can_read_trip(trip_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON trip_presence TO globetrotter_app;

-- Reap connections that vanished without a clean close (laptop lid, dead wifi).
CREATE FUNCTION app.reap_stale_presence(p_older_than interval DEFAULT interval '90 seconds')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM trip_presence WHERE last_seen < now() - p_older_than;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION app.reap_stale_presence(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reap_stale_presence(interval) TO globetrotter_app;
