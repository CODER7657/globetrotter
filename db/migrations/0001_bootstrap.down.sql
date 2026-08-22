-- Down migration for 0001_bootstrap. Every migration has a tested down (issue #1).
DROP POLICY IF EXISTS trip_activities_all ON trip_activities;
DROP POLICY IF EXISTS trip_stops_all      ON trip_stops;
DROP POLICY IF EXISTS trips_delete        ON trips;
DROP POLICY IF EXISTS trips_update        ON trips;
DROP POLICY IF EXISTS trips_insert        ON trips;
DROP POLICY IF EXISTS trips_select        ON trips;

DROP TRIGGER  IF EXISTS trg_trips_version ON trips;

DROP TABLE IF EXISTS trip_activities;
DROP TABLE IF EXISTS trip_stops;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS refresh_token_families;
DROP TABLE IF EXISTS users;

DROP FUNCTION IF EXISTS bump_trip_version();
DROP FUNCTION IF EXISTS current_app_user_id();

DROP TYPE IF EXISTS trip_visibility;
DROP TYPE IF EXISTS user_role;
