DROP TRIGGER IF EXISTS trip_stops_cascade_activities ON trip_stops;
DROP FUNCTION IF EXISTS app.cascade_delete_stop_activities();
DROP TABLE IF EXISTS trip_shares;
DROP TABLE IF EXISTS trip_collaborators;
DROP TABLE IF EXISTS trip_activities;
DROP TABLE IF EXISTS trip_stops;
DROP TABLE IF EXISTS trips;
