DROP POLICY   IF EXISTS trip_events_read ON trip_events;
DROP TRIGGER  IF EXISTS trip_events_no_update ON trip_events;
DROP TRIGGER  IF EXISTS trip_events_chain     ON trip_events;
DROP FUNCTION IF EXISTS app.verify_trip_chain(uuid);
DROP FUNCTION IF EXISTS app.append_trip_event(uuid, text, jsonb);
DROP FUNCTION IF EXISTS app.reject_trip_event_mutation();
DROP FUNCTION IF EXISTS app.chain_trip_event();
DROP TABLE    IF EXISTS trip_events;
DROP FUNCTION IF EXISTS app.record_share_view(text);
