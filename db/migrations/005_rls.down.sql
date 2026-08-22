DROP FUNCTION IF EXISTS app.stop_trip(uuid);
DROP FUNCTION IF EXISTS app.can_edit_trip(uuid);
DROP FUNCTION IF EXISTS app.can_read_trip(uuid);
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','refresh_token_families','refresh_tokens','trips',
                           'trip_stops','trip_activities','trip_collaborators','trip_shares']
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $do$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM globetrotter_app;
DROP OWNED BY globetrotter_app;
DROP ROLE IF EXISTS globetrotter_app;
