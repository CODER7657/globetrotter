-- ============================================================================
-- 006_share_views_and_audit — view counting works, and the chain detects edits
-- ============================================================================
TRUNCATE test.results;

DELETE FROM trip_events  WHERE trip_id IN ('e0000001-0000-7000-8000-00000000000e');
DELETE FROM trip_shares  WHERE trip_id IN ('e0000001-0000-7000-8000-00000000000e');
DELETE FROM trip_stops   WHERE trip_id IN ('e0000001-0000-7000-8000-00000000000e');
DELETE FROM trips        WHERE id      IN ('e0000001-0000-7000-8000-00000000000e');
DELETE FROM users        WHERE id      IN ('e0000000-0000-7000-8000-00000000000e');

INSERT INTO users(id,email,password_hash,display_name)
 VALUES ('e0000000-0000-7000-8000-00000000000e','share@test.io',repeat('$argon2id$',4),'Sharer');
INSERT INTO trips(id,owner_id,name,period,base_currency,visibility)
 VALUES ('e0000001-0000-7000-8000-00000000000e','e0000000-0000-7000-8000-00000000000e',
         'Shared trip','[2027-05-01,2027-05-06)','INR','unlisted');
INSERT INTO trip_shares(id,trip_id,slug,created_by)
 VALUES ('e0000002-0000-7000-8000-00000000000e','e0000001-0000-7000-8000-00000000000e',
         'aaaaBBBBccccDDDDeeee11','e0000000-0000-7000-8000-00000000000e');

-- ══════════════════ view counting, as the anonymous share path ═════════════
SET ROLE globetrotter_app;
SET app.user_id = '';
SET app.share_slug = 'aaaaBBBBccccDDDDeeee11';

-- This is the failure @Ayush3422 documented with a tripwire test in #55.
SELECT test.expect_eq($$
  WITH u AS (UPDATE trip_shares SET view_count = view_count + 1
              WHERE slug = 'aaaaBBBBccccDDDDeeee11' RETURNING 1)
  SELECT count(*)::text FROM u $$,
  '0', 'SHARE  a direct UPDATE from an anonymous share txn still matches zero rows');

SELECT test.expect_ok(
  $$SELECT app.record_share_view('aaaaBBBBccccDDDDeeee11')$$,
  'SHARE  record_share_view() is callable by the app role');

RESET ROLE;
SELECT test.expect_eq(
  $$SELECT view_count::text FROM trip_shares WHERE slug='aaaaBBBBccccDDDDeeee11'$$,
  '1', 'SHARE  the counter actually incremented');

-- A revoked slug must count nothing: revocation is enforced inside the function
-- rather than by a WHERE clause the caller could forget.
UPDATE trip_shares SET revoked_at = now() WHERE slug='aaaaBBBBccccDDDDeeee11';
SET ROLE globetrotter_app;
SELECT test.expect_ok($$SELECT app.record_share_view('aaaaBBBBccccDDDDeeee11')$$,
  'SHARE  recording a view on a revoked slug does not error');
RESET ROLE;
SELECT test.expect_eq(
  $$SELECT view_count::text FROM trip_shares WHERE slug='aaaaBBBBccccDDDDeeee11'$$,
  '1', 'SHARE  ...but does not increment either');
UPDATE trip_shares SET revoked_at = NULL WHERE slug='aaaaBBBBccccDDDDeeee11';

-- ══════════════════ the hash chain ═════════════════════════════════════════
SELECT app.append_trip_event('e0000001-0000-7000-8000-00000000000e','trip.created','{}'::jsonb);
SELECT app.append_trip_event('e0000001-0000-7000-8000-00000000000e','visibility.changed',
                             '{"from":"private","to":"unlisted"}'::jsonb);
SELECT app.append_trip_event('e0000001-0000-7000-8000-00000000000e','share.created','{}'::jsonb);

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_events WHERE trip_id='e0000001-0000-7000-8000-00000000000e'$$,
  '3', 'AUDIT  three events recorded');

SELECT test.expect_eq(
  $$SELECT (prev_hash IS NULL)::text FROM trip_events
     WHERE trip_id='e0000001-0000-7000-8000-00000000000e' ORDER BY seq LIMIT 1$$,
  'true', 'AUDIT  the first event has no predecessor');

SELECT test.expect_eq($$
  SELECT (e2.prev_hash = e1.hash)::text
    FROM trip_events e1, trip_events e2
   WHERE e1.trip_id = 'e0000001-0000-7000-8000-00000000000e'
     AND e2.trip_id = e1.trip_id
     AND e2.seq = e1.seq + 1
   LIMIT 1 $$,
  'true', 'AUDIT  each event links to the hash of the one before it');

SELECT test.expect_eq(
  $$SELECT coalesce(app.verify_trip_chain('e0000001-0000-7000-8000-00000000000e')::text,'intact')$$,
  'intact', 'AUDIT  an untouched chain verifies');

-- ══════════════════ append-only is enforced, not just intended ═════════════
SELECT test.expect_error(
  $$UPDATE trip_events SET payload = '{"tampered":true}'::jsonb
     WHERE trip_id='e0000001-0000-7000-8000-00000000000e'$$,
  '23001', 'AUDIT  UPDATE on trip_events is refused');

-- DELETE is not trigger-guarded: that would make trips undeletable, because
-- trip_id is ON DELETE CASCADE and the cascade fires the trigger per child row.
-- The dangerous case — removing ONE event while keeping its trip — is blocked by
-- RLS instead: there is a SELECT policy and no DELETE policy.
SET ROLE globetrotter_app;
SET app.user_id = 'e0000000-0000-7000-8000-00000000000e';
SELECT test.expect_eq($$
  WITH d AS (DELETE FROM trip_events
              WHERE trip_id='e0000001-0000-7000-8000-00000000000e' RETURNING 1)
  SELECT count(*)::text FROM d $$,
  '0', 'AUDIT  the app role cannot delete an individual event (no DELETE policy)');
RESET ROLE;

-- ══════════════════ and the chain DETECTS a forced edit ════════════════════
-- Disabling the guard trigger is the most privileged tamper available — a
-- superuser rewriting history directly. The chain must still notice.
ALTER TABLE trip_events DISABLE TRIGGER trip_events_no_update;
UPDATE trip_events SET payload = '{"tampered":true}'::jsonb
 WHERE trip_id='e0000001-0000-7000-8000-00000000000e'
   AND event_type = 'visibility.changed';
ALTER TABLE trip_events ENABLE TRIGGER trip_events_no_update;

SELECT test.expect_eq(
  $$SELECT (app.verify_trip_chain('e0000001-0000-7000-8000-00000000000e') IS NOT NULL)::text$$,
  'true', 'AUDIT  a forced edit is DETECTED by the chain');

SELECT test.expect_eq($$
  SELECT (app.verify_trip_chain('e0000001-0000-7000-8000-00000000000e')
        = (SELECT seq FROM trip_events
            WHERE trip_id='e0000001-0000-7000-8000-00000000000e'
              AND event_type='visibility.changed'))::text $$,
  'true', 'AUDIT  ...and it names the exact event that was altered');

-- Deleting the trip must still work: erasing the subject is not tampering, and a
-- user removing their own trip should not leave its history behind.
SELECT test.expect_ok(
  $$DELETE FROM trips WHERE id='e0000001-0000-7000-8000-00000000000e'$$,
  'AUDIT  deleting a trip with audit events cascades cleanly');

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_events WHERE trip_id='e0000001-0000-7000-8000-00000000000e'$$,
  '0', 'AUDIT  the trip''s events go with it');

SELECT test.report();
