-- Order matters: policies depend on the helper functions, so policies go first.
-- Dropping the functions with CASCADE would work but would silently take the
-- policies with them, which is exactly the kind of quiet action a down
-- migration should not take.

DROP POLICY IF EXISTS trip_shares_write        ON trip_shares;
DROP POLICY IF EXISTS trip_shares_read         ON trip_shares;
DROP POLICY IF EXISTS trip_collaborators_write ON trip_collaborators;
DROP POLICY IF EXISTS trip_collaborators_read  ON trip_collaborators;
DROP POLICY IF EXISTS trip_activities_write    ON trip_activities;
DROP POLICY IF EXISTS trip_activities_read     ON trip_activities;
DROP POLICY IF EXISTS trip_stops_write         ON trip_stops;
DROP POLICY IF EXISTS trip_stops_read          ON trip_stops;
DROP POLICY IF EXISTS trips_delete             ON trips;
DROP POLICY IF EXISTS trips_update             ON trips;
DROP POLICY IF EXISTS trips_insert             ON trips;
DROP POLICY IF EXISTS trips_read               ON trips;
DROP POLICY IF EXISTS rt_all                   ON refresh_tokens;
DROP POLICY IF EXISTS rtf_owner                ON refresh_token_families;
DROP POLICY IF EXISTS users_signup             ON users;
DROP POLICY IF EXISTS users_self_write         ON users;
DROP POLICY IF EXISTS users_self_read          ON users;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','refresh_token_families','refresh_tokens','trips',
                           'trip_stops','trip_activities','trip_collaborators','trip_shares']
  LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $do$;

DROP FUNCTION IF EXISTS app.stop_trip(uuid);
DROP FUNCTION IF EXISTS app.can_edit_trip(uuid);
DROP FUNCTION IF EXISTS app.can_read_trip(uuid);

-- DROP OWNED BY also removes the default-privileges entry and every grant, so
-- it must run before DROP ROLE. It is a no-op when the role does not exist,
-- hence the guard.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'globetrotter_app') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM globetrotter_app';
    EXECUTE 'DROP OWNED BY globetrotter_app';
    EXECUTE 'DROP ROLE globetrotter_app';
  END IF;
END $do$;
