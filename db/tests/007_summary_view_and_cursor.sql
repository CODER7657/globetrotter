-- ============================================================================
-- 007_summary_view_and_cursor — the two fixes from @Ayush3422's #66 review
-- ============================================================================
TRUNCATE test.results;

DELETE FROM trips WHERE id IN ('77700001-0000-7000-8000-000000000077');
DELETE FROM users WHERE id IN ('77700000-0000-7000-8000-000000000077',
                               '77700002-0000-7000-8000-000000000077',
                               '77700004-0000-7000-8000-000000000077');

INSERT INTO users(id,email,password_hash,display_name) VALUES
 ('77700000-0000-7000-8000-000000000077','sum-owner@test.io',  repeat('$argon2id$',4),'Owner'),
 ('77700002-0000-7000-8000-000000000077','sum-collab@test.io', repeat('$argon2id$',4),'Collab'),
 ('77700004-0000-7000-8000-000000000077','sum-stranger@test.io',repeat('$argon2id$',4),'Stranger');

INSERT INTO trips(id,owner_id,name,period,base_currency)
 VALUES ('77700001-0000-7000-8000-000000000077','77700000-0000-7000-8000-000000000077',
         'Summary probe','[2027-09-01,2027-09-05)','INR');

INSERT INTO trip_stops(id,trip_id,city_id,seq,period,arrival_cost,lodging_cost)
 SELECT '77700003-0000-7000-8000-000000000077','77700001-0000-7000-8000-000000000077',id,1,
        '[2027-09-01 00:00+00,2027-09-03 00:00+00)',5000,3000 FROM cities WHERE slug='goa';

INSERT INTO trip_collaborators(trip_id,user_id,role)
 VALUES ('77700001-0000-7000-8000-000000000077','77700002-0000-7000-8000-000000000077','editor');

-- ══════════ the view is LIVE — there is no refresh to forget ═══════════════
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '1', 'SUMMARY  a brand-new trip appears immediately, with no REFRESH');

SELECT test.expect_eq(
  $$SELECT total_cost::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '8000.00', 'SUMMARY  one stop at 5000+3000 totals 8000');

-- ══════════ THE FAN-OUT REGRESSION ═════════════════════════════════════════
-- The first version chained LEFT JOIN trip_stops → LEFT JOIN trip_activities,
-- which fans one row per activity and counts the stop cost once PER ACTIVITY.
-- Measured: 24,600 instead of 8,600. Three activities is the smallest case that
-- catches it — with one activity the wrong query gives the right answer.
INSERT INTO trip_activities(stop_id,title,slot,cost_amount) VALUES
 ('77700003-0000-7000-8000-000000000077','A','[2027-09-01 09:00+00,2027-09-01 10:00+00)',100),
 ('77700003-0000-7000-8000-000000000077','B','[2027-09-01 11:00+00,2027-09-01 12:00+00)',200),
 ('77700003-0000-7000-8000-000000000077','C','[2027-09-01 13:00+00,2027-09-01 14:00+00)',300);

SELECT test.expect_eq(
  $$SELECT total_cost::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '8600.00', 'SUMMARY  three activities do NOT multiply the stop cost (was 24600)');

SELECT test.expect_eq(
  $$SELECT stop_count::text||'/'||activity_count::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '1/3', 'SUMMARY  counts are not multiplied either');

-- The reason the MV had to go: a dashboard card that disagrees with the budget
-- panel on the same screen is worse than a slow dashboard.
SELECT test.expect_eq($$
  SELECT ((SELECT total_cost FROM trip_cost_summary
            WHERE trip_id='77700001-0000-7000-8000-000000000077')
        = (app.trip_cost_breakdown('77700001-0000-7000-8000-000000000077')->>'total')::numeric
        )::text $$,
  'true', 'SUMMARY  the card total EQUALS the live breakdown total');

-- ══════════ security_invoker: RLS applies, so the API filters nothing ══════
SET ROLE globetrotter_app;

SET app.user_id = '77700000-0000-7000-8000-000000000077';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '1', 'RLS  the owner sees their trip through the view');

-- @Ayush3422's point: an owner_id filter would UNDER-fetch here, silently
-- hiding a trip a collaborator legitimately sees.
SET app.user_id = '77700002-0000-7000-8000-000000000077';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '1', 'RLS  a COLLABORATOR sees it too — an owner-only filter would hide it');

SET app.user_id = '77700004-0000-7000-8000-000000000077';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '0', 'RLS  a stranger sees nothing — no hand-written WHERE required');

SET app.user_id = '';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_cost_summary
     WHERE trip_id='77700001-0000-7000-8000-000000000077'$$,
  '0', 'RLS  anonymous sees nothing');

RESET ROLE;

-- ══════════ search keyset cursor ═══════════════════════════════════════════
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM app.search_places('tour','all',NULL,NULL,NULL,NULL,'INR',5)$$,
  '5', 'CURSOR  first page honours the limit');

-- Keyset on (score, id): RRF scores tie, so ordering by score alone would drop
-- or repeat rows across pages.
SELECT test.expect_eq($$
  WITH p1 AS (
    SELECT id, score FROM app.search_places('tour','all',NULL,NULL,NULL,NULL,'INR',5)
  ), cur AS (
    SELECT score, id FROM p1 ORDER BY score DESC, id DESC LIMIT 1 OFFSET 4
  ), p2 AS (
    SELECT s.id FROM cur, LATERAL app.search_places(
      'tour','all',NULL,NULL,NULL,NULL,'INR',5, cur.score, cur.id) s
  )
  SELECT count(*)::text FROM p1 JOIN p2 ON p1.id = p2.id $$,
  '0', 'CURSOR  page 2 shares NO row with page 1');

SELECT test.expect_eq($$
  WITH p1 AS (
    SELECT id, score FROM app.search_places('tour','all',NULL,NULL,NULL,NULL,'INR',5)
  ), cur AS (
    SELECT score, id FROM p1 ORDER BY score DESC, id DESC LIMIT 1 OFFSET 4
  ), p2 AS (
    SELECT s.id FROM cur, LATERAL app.search_places(
      'tour','all',NULL,NULL,NULL,NULL,'INR',5, cur.score, cur.id) s
  ), all_rows AS (
    SELECT id FROM app.search_places('tour','all',NULL,NULL,NULL,NULL,'INR',10)
  )
  SELECT (
    (SELECT count(*) FROM (SELECT id FROM p1 UNION SELECT id FROM p2) u)
    = (SELECT count(*) FROM all_rows)
  )::text $$,
  'true', 'CURSOR  two pages of 5 cover exactly the same rows as one page of 10');

-- p_currency no longer defaults to INR while users.home_currency defaults to
-- USD — the caller must decide, so a cost filter cannot silently compare
-- against a currency the user never chose.
SELECT test.expect_ok(
  $$SELECT * FROM app.search_places('tour','all',NULL,NULL,NULL,NULL,NULL,3)$$,
  'CURSOR  a NULL currency still works (falls back internally, does not raise)');

SELECT test.report();
