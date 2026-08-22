-- ============================================================================
-- 003_cost_and_search — cost engine invariants and hybrid retrieval behaviour
-- ============================================================================

BEGIN;

TRUNCATE test.results;   -- each suite reports only its own assertions

-- ------------------------------------------------------------- fixtures ---
INSERT INTO users(id,email,password_hash,display_name,home_currency)
 VALUES ('d0000000-0000-7000-8000-00000000000d','cost@test.io',repeat('$argon2id$',4),'Coster','INR')
 ON CONFLICT DO NOTHING;

INSERT INTO trips(id,owner_id,name,period,base_currency,budget_cap,status)
 VALUES ('d1000000-0000-7000-8000-00000000000d','d0000000-0000-7000-8000-00000000000d',
         'Golden Triangle','[2026-11-01,2026-11-08)','INR',60000,'planned')
 ON CONFLICT DO NOTHING;

INSERT INTO trip_stops(id,trip_id,city_id,seq,period,arrival_cost,lodging_cost)
 SELECT 'd1100000-0000-7000-8000-00000000000d','d1000000-0000-7000-8000-00000000000d',id,1,
        '[2026-11-01 10:00+00,2026-11-04 10:00+00)',7500,9000 FROM cities WHERE slug='new-delhi';
INSERT INTO trip_stops(id,trip_id,city_id,seq,period,arrival_cost,lodging_cost)
 SELECT 'd1200000-0000-7000-8000-00000000000d','d1000000-0000-7000-8000-00000000000d',id,2,
        '[2026-11-04 11:00+00,2026-11-06 10:00+00)',2200,6000 FROM cities WHERE slug='agra';
INSERT INTO trip_stops(id,trip_id,city_id,seq,period,arrival_cost,lodging_cost)
 SELECT 'd1300000-0000-7000-8000-00000000000d','d1000000-0000-7000-8000-00000000000d',id,3,
        '[2026-11-06 15:00+00,2026-11-08 00:00+00)',3100,7000 FROM cities WHERE slug='jaipur';

INSERT INTO trip_activities(stop_id,activity_id,title,slot,category,cost_amount)
 SELECT 'd1200000-0000-7000-8000-00000000000d',a.id,a.name,
        '[2026-11-05 06:00+00,2026-11-05 09:00+00)','activity',a.cost_amount
   FROM activities a WHERE a.slug='taj-mahal-sunrise';
INSERT INTO trip_activities(stop_id,activity_id,title,slot,category,cost_amount)
 SELECT 'd1100000-0000-7000-8000-00000000000d',a.id,a.name,
        '[2026-11-02 10:00+00,2026-11-02 12:00+00)','activity',a.cost_amount
   FROM activities a WHERE a.slug='humayuns-tomb';

-- ══════════════════════════ FX conversion ══════════════════════════════════
SELECT test.expect_eq($$SELECT app.fx_convert(100,'INR','INR')::text$$, '100',
  'FX  same-currency conversion is the identity');

SELECT test.expect_eq(
  $$SELECT (app.fx_convert(app.fx_convert(1000,'INR','JPY'),'JPY','INR') BETWEEN 995 AND 1005)::text$$,
  'true', 'FX  INR -> JPY -> INR round-trips within rounding tolerance');

-- EUR->THB has no direct seeded pair; it must pivot through INR rather than fail.
SELECT test.expect_eq(
  $$SELECT (app.fx_convert(100,'EUR','THB') > 0)::text$$, 'true',
  'FX  cross-pair with no direct rate pivots through INR');

SELECT test.expect_error($$SELECT app.fx_convert(100,'INR','ZZZ')$$, 'P0002',
  'FX  unknown currency RAISES rather than returning a plausible wrong number');

-- ══════════════════════════ cost engine ════════════════════════════════════
SELECT test.expect_eq(
  $$SELECT (app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->>'total')::numeric::text$$,
  '36700.00', 'COST  total matches hand-computed 7500+9000+2200+6000+3100+7000+1300+600');

-- The invariant that actually matters: the per-day series must reconcile to the
-- headline total. If lodging amortisation drifts, the chart and the number on
-- the same screen disagree, which is worse than either being wrong alone.
SELECT test.expect_eq($$
  SELECT (
    (SELECT sum((d->>'amount')::numeric)
       FROM jsonb_array_elements(app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->'perDay') d)
    = (app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->>'total')::numeric
  )::text $$, 'true',
  'COST  per-day series sums EXACTLY to the headline total');

SELECT test.expect_eq(
  $$SELECT jsonb_array_length(app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->'perDay')::text$$,
  '7', 'COST  every calendar day appears, including days with no spend');

SELECT test.expect_eq(
  $$SELECT (app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->>'remaining')::numeric::text$$,
  '23300.00', 'COST  remaining budget = cap - total');

SELECT test.expect_eq(
  $$SELECT app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->>'overBudget'$$,
  'false', 'COST  under cap is not flagged over budget');

-- 10:00 depart Delhi, 11:00 arrive Agra = 60 minutes, under the 90-minute floor.
SELECT test.expect_eq(
  $$SELECT jsonb_array_length(app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->'warnings')::text$$,
  '1', 'COST  the 60-minute Delhi->Agra transfer is flagged');

SELECT test.expect_eq(
  $$SELECT app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->'warnings'->0->>'gapMinutes'$$,
  '60', 'COST  the warning reports the actual gap');

SELECT test.expect_eq(
  $$SELECT jsonb_array_length(app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->'stops')::text$$,
  '3', 'COST  all three stops are present, in sequence');

-- Drop the cap below the total and the flag must flip.
UPDATE trips SET budget_cap = 20000 WHERE id='d1000000-0000-7000-8000-00000000000d';
SELECT test.expect_eq(
  $$SELECT app.trip_cost_breakdown('d1000000-0000-7000-8000-00000000000d')->>'overBudget'$$,
  'true', 'COST  lowering the cap below total flips overBudget');
UPDATE trips SET budget_cap = 60000 WHERE id='d1000000-0000-7000-8000-00000000000d';

-- An empty trip must return a well-formed zero, not NULL and not an error.
INSERT INTO trips(id,owner_id,name,period,base_currency,status)
 VALUES ('d2000000-0000-7000-8000-00000000000d','d0000000-0000-7000-8000-00000000000d',
         'Empty','[2027-03-01,2027-03-04)','INR','draft') ON CONFLICT DO NOTHING;
SELECT test.expect_eq(
  $$SELECT (app.trip_cost_breakdown('d2000000-0000-7000-8000-00000000000d')->>'total')::text$$,
  '0', 'COST  a trip with no stops returns zero, not null');

-- ══════════════════════════ hybrid search ══════════════════════════════════
SELECT test.expect_eq(
  $$SELECT name FROM app.search_places('jaipur') LIMIT 1$$, 'Jaipur',
  'SEARCH  exact city name ranks first');

SELECT test.expect_eq(
  $$SELECT name FROM app.search_places('barcelnoa') LIMIT 1$$, 'Barcelona',
  'SEARCH  typo "barcelnoa" still finds Barcelona (trigram arm)');

SELECT test.expect_eq(
  $$SELECT name FROM app.search_places('kyto') LIMIT 1$$, 'Kyoto',
  'SEARCH  typo "kyto" still finds Kyoto');

SELECT test.expect_eq(
  $$SELECT 'fuzzy' = ANY(matched_by)::boolean::text FROM app.search_places('barcelnoa') LIMIT 1$$,
  'true', 'SEARCH  the typo match is attributed to the fuzzy arm');

SELECT test.expect_eq(
  $$SELECT (array_length(matched_by,1) >= 2)::text FROM app.search_places('jaipur') LIMIT 1$$,
  'true', 'SEARCH  an exact match is found by BOTH arms — RRF is genuinely fusing');

SELECT test.expect_eq(
  $$SELECT (count(*) > 0)::text FROM app.search_places('')$$, 'true',
  'SEARCH  empty query browses popular destinations instead of returning nothing');

SELECT test.expect_eq(
  $$SELECT (count(*) FILTER (WHERE kind <> 'city') = 0)::text
      FROM app.search_places('taj', 'city')$$, 'true',
  'SEARCH  kind filter excludes activities');

SELECT test.expect_eq(
  $$SELECT (count(*) FILTER (WHERE country_code <> 'IN') = 0)::text
      FROM app.search_places('tour', 'all', 'IN')$$, 'true',
  'SEARCH  country filter is applied');

SELECT test.expect_eq(
  $$SELECT (count(*) <= 3)::text FROM app.search_places('tour','all',NULL,NULL,NULL,NULL,'INR',3)$$,
  'true', 'SEARCH  limit is honoured');

-- Injection attempt: websearch_to_tsquery must treat this as text, not syntax.
SELECT test.expect_ok(
  $$SELECT * FROM app.search_places('''; DROP TABLE cities; --')$$,
  'SEARCH  hostile input is treated as a search term, never as syntax');

SELECT test.expect_ok(
  $$SELECT * FROM app.search_places('& | ! ( ) : *')$$,
  'SEARCH  tsquery metacharacters do not raise');

SELECT test.expect_eq(
  $$SELECT name FROM app.search_places('taj mahal') LIMIT 1$$, 'Taj Mahal at Sunrise',
  'SEARCH  multi-word activity query ranks the named activity first');

SELECT test.report();

ROLLBACK;
