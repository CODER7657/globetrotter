-- ============================================================================
-- 005_realtime — NOTIFY fires, carries ids only, and bumps the version
-- ============================================================================
TRUNCATE test.results;

-- This suite cannot run inside a transaction (it uses SET ROLE), so its rows
-- persist and it MUST be idempotent — otherwise the second run collides on the
-- fixed fixture ids and CI fails on any rerun. Clear our own fixtures first.
DELETE FROM trip_presence      WHERE trip_id IN ('c0ffee01-0000-7000-8000-00000000000c');
DELETE FROM trip_activities    WHERE stop_id IN ('c0ffee02-0000-7000-8000-00000000000c');
DELETE FROM trip_collaborators WHERE trip_id IN ('c0ffee01-0000-7000-8000-00000000000c');
DELETE FROM trip_stops         WHERE trip_id IN ('c0ffee01-0000-7000-8000-00000000000c');
DELETE FROM trips              WHERE id      IN ('c0ffee01-0000-7000-8000-00000000000c');
DELETE FROM refresh_tokens          WHERE family_id IN ('00000000-0000-0000-0000-000000000000');
DELETE FROM refresh_token_families  WHERE id        IN ('00000000-0000-0000-0000-000000000000');
DELETE FROM users              WHERE id      IN ('c0ffee00-0000-7000-8000-00000000000c');

INSERT INTO users(id,email,password_hash,display_name)
 VALUES ('c0ffee00-0000-7000-8000-00000000000c','rt@test.io',repeat('$argon2id$',4),'RT')
 ON CONFLICT DO NOTHING;
INSERT INTO trips(id,owner_id,name,period,base_currency)
 VALUES ('c0ffee01-0000-7000-8000-00000000000c','c0ffee00-0000-7000-8000-00000000000c',
         'RT Trip','[2026-12-01,2026-12-06)','INR') ON CONFLICT DO NOTHING;

SELECT test.expect_eq(
  $$SELECT app.trip_channel('c0ffee01-0000-7000-8000-00000000000c')$$,
  'gt_trip_c0ffee01000070008000' || '00000000000c',
  'RT  channel name is derived from the trip id with hyphens stripped');

SELECT test.expect_eq(
  $$SELECT (length(app.trip_channel(gen_random_uuid())) <= 63)::text$$, 'true',
  'RT  channel name fits inside the 63-character identifier limit');

-- ── version bumping ────────────────────────────────────────────────────────
SELECT test.expect_eq(
  $$SELECT version::text FROM trips WHERE id='c0ffee01-0000-7000-8000-00000000000c'$$,
  '1', 'RT  a new trip starts at version 1');

INSERT INTO trip_stops(id,trip_id,city_id,seq,period)
 SELECT 'c0ffee02-0000-7000-8000-00000000000c','c0ffee01-0000-7000-8000-00000000000c',
        id,1,'[2026-12-01 00:00+00,2026-12-04 00:00+00)' FROM cities WHERE slug='jaipur';

SELECT test.expect_eq(
  $$SELECT version::text FROM trips WHERE id='c0ffee01-0000-7000-8000-00000000000c'$$,
  '2', 'RT  adding a STOP bumps the parent trip version');

INSERT INTO trip_activities(stop_id,title,slot)
 VALUES ('c0ffee02-0000-7000-8000-00000000000c','Fort',
         '[2026-12-02 09:00+00,2026-12-02 11:00+00)');

SELECT test.expect_eq(
  $$SELECT version::text FROM trips WHERE id='c0ffee01-0000-7000-8000-00000000000c'$$,
  '3', 'RT  adding an ACTIVITY bumps the parent trip version too');

UPDATE trip_stops SET notes='changed' WHERE id='c0ffee02-0000-7000-8000-00000000000c';
SELECT test.expect_eq(
  $$SELECT version::text FROM trips WHERE id='c0ffee01-0000-7000-8000-00000000000c'$$,
  '4', 'RT  updating a stop bumps the version (stale clients are caught)');

-- ── the emitter itself ─────────────────────────────────────────────────────
-- A NOTIFY from the current session is not observable inside the same
-- transaction, so assert on the trigger wiring rather than the delivery. The
-- delivery path is covered end to end by the API integration test.
SELECT test.expect_eq($$
  SELECT count(*)::text FROM pg_trigger
   WHERE tgname IN ('trips_notify','trip_stops_notify','trip_activities_notify')
     AND NOT tgisinternal $$,
  '3', 'RT  all three notify triggers are attached');

SELECT test.expect_ok(
  $$SELECT pg_notify(app.trip_channel('c0ffee01-0000-7000-8000-00000000000c'), '{"probe":true}')$$,
  'RT  the derived channel name is accepted by pg_notify');

-- A stop whose parent trip is gone must not raise; the trip-level DELETE event
-- already told every client to drop the whole thing.
SELECT test.expect_ok(
  $$DELETE FROM trips WHERE id='c0ffee01-0000-7000-8000-00000000000c'$$,
  'RT  deleting a trip with children does not break the notify trigger');

-- ── presence ───────────────────────────────────────────────────────────────
SELECT test.expect_eq(
  $$SELECT relpersistence::text FROM pg_class WHERE relname='trip_presence'$$,
  'u', 'RT  presence is UNLOGGED — ephemeral state should not pay for WAL');

SELECT test.expect_eq(
  $$SELECT (relrowsecurity AND relforcerowsecurity)::text
      FROM pg_class WHERE relname='trip_presence'$$,
  'true', 'RT  presence has RLS enabled AND forced');

SELECT test.expect_eq(
  $$SELECT app.reap_stale_presence(interval '0 seconds')::text$$, '0',
  'RT  the stale-presence reaper runs and reports a count');

-- A trips UPDATE that only moved version/updated_at must NOT emit. Without the
-- suppression, every graph edit fires twice and every client refetches twice.
-- Adding a stop bumps trips.version, which re-fires the trips trigger. Without
-- suppression every graph edit emits TWO events and every client refetches
-- twice. The suppression is asserted BEHAVIOURALLY in the API integration test
-- (realtime.integration.test.ts, "delivers a NOTIFY raised by a write from an
-- entirely separate connection"), which requires the FIRST frame to be the stop
-- event — a duplicate trip/UPDATE would arrive first and fail it.
--
-- A NOTIFY is not observable from inside the transaction that raised it, so
-- there is no honest way to assert delivery here. All this file can check is
-- that the wiring exists; anything more would be a test shaped to pass.
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM pg_trigger
     WHERE tgrelid = 'trips'::regclass AND tgname = 'trips_notify'$$,
  '1', 'RT  the notify trigger on trips is attached exactly once');

SELECT test.report();
