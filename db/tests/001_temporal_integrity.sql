-- ============================================================================
-- 001_temporal_integrity — proves the three guarantees in 004_trips.
--
-- This file is a demo asset as much as a test. It is the artifact that backs
-- the claim "an impossible itinerary has no representation in this schema".
--
-- SQLSTATE reference:
--   23P01  exclusion_violation
--   23503  foreign_key_violation
--   23514  check_violation
--   23505  unique_violation
-- ============================================================================

BEGIN;

TRUNCATE test.results;   -- each suite reports only its own assertions

-- ------------------------------------------------------------- fixtures ---
INSERT INTO currencies(code, name, symbol) VALUES
  ('EUR','Euro','EUR'), ('USD','US Dollar','USD')
ON CONFLICT (code) DO NOTHING;

INSERT INTO countries(code, name, region, currency_code)
  VALUES ('FR','France','Europe','EUR') ON CONFLICT (code) DO NOTHING;
-- Fixture cities use zz- slugs so they can never collide with seeded cities.

INSERT INTO cities(id, country_code, name, slug, latitude, longitude, timezone) VALUES
  ('11111111-1111-7111-8111-111111111111','FR','zz Test City A','zz-test-city-a',48.85660,2.35220,'Europe/Paris'),
  ('22222222-2222-7222-8222-222222222222','FR','zz Test City B','zz-test-city-b',45.76400,4.83570,'Europe/Paris')
ON CONFLICT DO NOTHING;

INSERT INTO users(id, email, password_hash, display_name)
  VALUES ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','tester@globetrotter.test', repeat('$argon2id$', 4), 'Tester')
ON CONFLICT DO NOTHING;

INSERT INTO trips(id, owner_id, name, period, base_currency, status)
  VALUES ('bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
          'Test Trip','[2026-09-01,2026-09-10)','EUR','planned')
ON CONFLICT DO NOTHING;

INSERT INTO trip_stops(id, trip_id, city_id, seq, period) VALUES
  ('cccccccc-cccc-7ccc-8ccc-cccccccccc01','bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
   '11111111-1111-7111-8111-111111111111', 1, '[2026-09-01 00:00+00,2026-09-05 00:00+00)');

-- ══════════════ GUARANTEE 1 — you cannot be in two cities at once ══════════
SELECT test.expect_error($$
  INSERT INTO trip_stops(trip_id, city_id, seq, period) VALUES
    ('bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb','22222222-2222-7222-8222-222222222222',2,
     '[2026-09-04 00:00+00,2026-09-08 00:00+00)')
$$, '23P01', 'G1  overlapping stop in the same trip is rejected');

SELECT test.expect_ok($$
  INSERT INTO trip_stops(id, trip_id, city_id, seq, period) VALUES
    ('cccccccc-cccc-7ccc-8ccc-cccccccccc02','bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
     '22222222-2222-7222-8222-222222222222',2,'[2026-09-05 00:00+00,2026-09-08 00:00+00)')
$$, 'G1  back-to-back stop (touching bounds) is allowed');

-- ══════════════ GUARANTEE 2 — no double-booking inside one stop ════════════
SELECT test.expect_ok($$
  INSERT INTO trip_activities(id, stop_id, title, slot) VALUES
    ('dddddddd-dddd-7ddd-8ddd-dddddddddd01','cccccccc-cccc-7ccc-8ccc-cccccccccc01',
     'Louvre','[2026-09-02 09:00+00,2026-09-02 12:00+00)')
$$, 'G2  activity inside its stop is accepted');

SELECT test.expect_error($$
  INSERT INTO trip_activities(stop_id, title, slot) VALUES
    ('cccccccc-cccc-7ccc-8ccc-cccccccccc01','Orsay','[2026-09-02 11:00+00,2026-09-02 14:00+00)')
$$, '23P01', 'G2  overlapping activity in the same stop is rejected');

SELECT test.expect_ok($$
  INSERT INTO trip_activities(stop_id, title, slot) VALUES
    ('cccccccc-cccc-7ccc-8ccc-cccccccccc01','Orsay','[2026-09-02 12:00+00,2026-09-02 14:00+00)')
$$, 'G2  back-to-back activities are allowed');

-- ══════════ GUARANTEE 3 — an activity cannot escape its parent stop ════════
SELECT test.expect_error($$
  INSERT INTO trip_activities(stop_id, title, slot) VALUES
    ('cccccccc-cccc-7ccc-8ccc-cccccccccc01','Ghost','[2026-09-09 09:00+00,2026-09-09 12:00+00)')
$$, '23503', 'G3  activity scheduled outside its stop is rejected');

SELECT test.expect_error($$
  INSERT INTO trip_activities(stop_id, title, slot) VALUES
    ('cccccccc-cccc-7ccc-8ccc-cccccccccc01','Straddler','[2026-09-04 22:00+00,2026-09-05 02:00+00)')
$$, '23503', 'G3  activity straddling the end of its stop is rejected');

SELECT test.expect_error($$
  UPDATE trip_stops SET period = '[2026-09-01 00:00+00,2026-09-02 00:00+00)'
   WHERE id = 'cccccccc-cccc-7ccc-8ccc-cccccccccc01'
$$, '23503', 'G3  shrinking a stop out from under an activity is rejected');

-- ══════════ GUARANTEE 4 — one traveller, one committed trip at a time ══════
SELECT test.expect_error($$
  INSERT INTO trips(owner_id, name, period, base_currency, status) VALUES
    ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Clash','[2026-09-05,2026-09-12)','EUR','planned')
$$, '23P01', 'G4  overlapping committed trips for one owner are rejected');

SELECT test.expect_ok($$
  INSERT INTO trips(owner_id, name, period, base_currency, status) VALUES
    ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Draft alternative','[2026-09-05,2026-09-12)','EUR','draft')
$$, 'G4  overlapping DRAFT trips are allowed (comparing plans is legitimate)');

-- ══════════ CASCADE — deleting a trip must actually work ═══════════════════
SELECT test.expect_ok($$
  DELETE FROM trips WHERE id = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
$$, 'CASCADE  deleting a trip with stops and activities succeeds');

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_activities$$, '0',
  'CASCADE  no orphaned activities remain');

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_stops$$, '0',
  'CASCADE  no orphaned stops remain');

-- ══════════ FIELD VALIDATION — the CHECK constraints ═══════════════════════
SELECT test.expect_error($$
  INSERT INTO users(email, password_hash, display_name)
  VALUES ('not-an-email', repeat('x',30), 'Bad')
$$, '23514', 'VALID  malformed email is rejected at the storage layer');

SELECT test.expect_error($$
  INSERT INTO users(email, password_hash, display_name)
  VALUES ('blank@name.test', repeat('x',30), '   ')
$$, '23514', 'VALID  whitespace-only display name is rejected');

SELECT test.expect_error($$
  INSERT INTO cities(country_code,name,slug,latitude,longitude,timezone)
  VALUES ('FR','Nowhere','nowhere',999,0,'Europe/Paris')
$$, '23514', 'VALID  out-of-range latitude is rejected');

SELECT test.expect_error($$
  INSERT INTO trips(owner_id,name,period,base_currency)
  VALUES ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Neg','[2026-09-01,2026-09-05)','EUR')
  RETURNING (SELECT 1/0)
$$, '22012', 'VALID  harness itself surfaces unexpected errors');

SELECT test.expect_error($$
  INSERT INTO trips(owner_id,name,period,base_currency,budget_cap)
  VALUES ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Neg budget','[2027-01-01,2027-01-05)','EUR',-100)
$$, '23514', 'VALID  negative budget cap is rejected');

SELECT test.expect_error($$
  INSERT INTO trips(owner_id,name,period,base_currency)
  VALUES ('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa','Unbounded','[2027-01-01,)','EUR')
$$, '23514', 'VALID  unbounded trip period is rejected');

SELECT test.expect_error($$
  INSERT INTO users(email,password_hash,display_name,home_currency)
  VALUES ('fx@test.io', repeat('x',30),'FX','XXX')
$$, '23503', 'VALID  unknown currency code is rejected');

-- ══════════ SOFT DELETE — email is reusable after account deletion ═════════
SELECT test.expect_ok($$
  INSERT INTO users(id,email,password_hash,display_name,deleted_at)
  VALUES ('eeeeeeee-eeee-7eee-8eee-eeeeeeeeee01','recycle@test.io',repeat('x',30),'Gone',now())
$$, 'SOFT  soft-deleted user can exist');

SELECT test.expect_ok($$
  INSERT INTO users(email,password_hash,display_name)
  VALUES ('recycle@test.io',repeat('x',30),'New owner of the address')
$$, 'SOFT  address is reusable once the old account is soft-deleted');

SELECT test.expect_error($$
  INSERT INTO users(email,password_hash,display_name)
  VALUES ('recycle@test.io',repeat('x',30),'Duplicate of a live account')
$$, '23505', 'SOFT  duplicate address among LIVE accounts is still rejected');

-- Case-insensitivity via citext
SELECT test.expect_error($$
  INSERT INTO users(email,password_hash,display_name)
  VALUES ('RECYCLE@TEST.IO',repeat('x',30),'Case variant')
$$, '23505', 'SOFT  email uniqueness is case-insensitive (citext)');

SELECT test.report();

ROLLBACK;
