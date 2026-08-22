-- ============================================================================
-- 002_rls — proves authorization actually holds, as the app role.
--
-- This suite MUST run as globetrotter_app. Run as a superuser it would pass
-- vacuously, which is exactly the trap @Ayush3422 hit in #44: every policy
-- looked right and the connection bypassed all of them.
-- ============================================================================

\set ON_ERROR_STOP on

TRUNCATE test.results;   -- each suite reports only its own assertions

-- ------------------------------------------------------------- fixtures ---
-- Seeded as the migration role (superuser), before we drop to the app role.
-- USD is required even though this suite uses EUR: users.home_currency defaults
-- to 'USD' and carries an FK, so the row must exist for any user INSERT.
INSERT INTO currencies(code,name,symbol) VALUES ('EUR','Euro','EUR'), ('USD','US Dollar','USD')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO countries(code,name,region,currency_code) VALUES ('IT','Italy','Europe','EUR')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO cities(id,country_code,name,slug,latitude,longitude,timezone) VALUES
  ('33333333-3333-7333-8333-333333333333','IT','zz Test City C','zz-test-city-c',41.9028,12.4964,'Europe/Rome')
  ON CONFLICT DO NOTHING;

INSERT INTO users(id,email,password_hash,display_name) VALUES
  ('a0000000-0000-7000-8000-00000000000a','alice@test.io', repeat('$argon2id$',4),'Alice'),
  ('b0000000-0000-7000-8000-00000000000b','bob@test.io',   repeat('$argon2id$',4),'Bob'),
  ('c0000000-0000-7000-8000-00000000000c','carol@test.io', repeat('$argon2id$',4),'Carol')
  ON CONFLICT DO NOTHING;
UPDATE users SET role='admin' WHERE id='c0000000-0000-7000-8000-00000000000c';

INSERT INTO trips(id,owner_id,name,period,base_currency,visibility) VALUES
  ('a1000000-0000-7000-8000-00000000000a','a0000000-0000-7000-8000-00000000000a',
   'Alice private','[2026-10-01,2026-10-08)','EUR','private'),
  ('a2000000-0000-7000-8000-00000000000a','a0000000-0000-7000-8000-00000000000a',
   'Alice public','[2026-11-01,2026-11-08)','EUR','public')
  ON CONFLICT DO NOTHING;

INSERT INTO trip_stops(id,trip_id,city_id,seq,period) VALUES
  ('a1100000-0000-7000-8000-00000000000a','a1000000-0000-7000-8000-00000000000a',
   '33333333-3333-7333-8333-333333333333',1,'[2026-10-01 00:00+00,2026-10-04 00:00+00)');

GRANT USAGE ON SCHEMA test TO globetrotter_app;
GRANT ALL ON test.results TO globetrotter_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA test TO globetrotter_app;

-- ══════════════════ drop privileges — everything below is the API ══════════
-- NOTE: plain SET, not SET LOCAL. Under psql autocommit each statement is its
-- own transaction, so SET LOCAL would be discarded before the next line runs —
-- app.current_user_id() would be NULL throughout and the isolation assertions
-- would pass vacuously. The API uses SET LOCAL inside a real transaction.
SET ROLE globetrotter_app;

SELECT test.expect_eq($$SELECT current_user$$, 'globetrotter_app',
  'RLS  suite is running as the least-privilege app role');
SELECT test.expect_eq($$SELECT (rolsuper OR rolbypassrls)::text FROM pg_roles WHERE rolname=current_user$$,
  'false', 'RLS  app role is neither superuser nor BYPASSRLS');

-- ── Bob must not see Alice's private trip ──────────────────────────────────
SET app.user_id = 'b0000000-0000-7000-8000-00000000000b';

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trips WHERE id='a1000000-0000-7000-8000-00000000000a'$$,
  '0', 'RLS  Bob cannot read Alice''s PRIVATE trip  <-- the #44 finding');

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trips WHERE id='a2000000-0000-7000-8000-00000000000a'$$,
  '1', 'RLS  Bob CAN read Alice''s PUBLIC trip');

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_stops WHERE trip_id='a1000000-0000-7000-8000-00000000000a'$$,
  '0', 'RLS  Bob cannot read stops of a trip he cannot read');

-- Writing to someone else's trip is silently filtered (UPDATE matches 0 rows),
-- which is the correct RLS behaviour — nothing to leak in an error message.
SELECT test.expect_eq(
  $$WITH u AS (UPDATE trips SET name='hijacked'
                WHERE id='a1000000-0000-7000-8000-00000000000a' RETURNING 1)
    SELECT count(*)::text FROM u$$,
  '0', 'RLS  Bob''s UPDATE of Alice''s trip affects zero rows');

SELECT test.expect_error(
  $$INSERT INTO trips(owner_id,name,period,base_currency)
    VALUES ('a0000000-0000-7000-8000-00000000000a','Forged','[2026-12-01,2026-12-05)','EUR')$$,
  '42501', 'RLS  Bob cannot create a trip owned by Alice');

SELECT test.expect_eq($$SELECT count(*)::text FROM users$$, '1',
  'RLS  Bob sees only his own user row');

-- ── Alice sees her own ─────────────────────────────────────────────────────
SET app.user_id = 'a0000000-0000-7000-8000-00000000000a';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trips WHERE owner_id='a0000000-0000-7000-8000-00000000000a'$$,
  '2', 'RLS  Alice reads both of her own trips');
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trip_stops WHERE trip_id='a1000000-0000-7000-8000-00000000000a'$$,
  '1', 'RLS  Alice reads stops of her own trip');

-- ── Collaborator: viewer reads, cannot write ───────────────────────────────
RESET ROLE;
INSERT INTO trip_collaborators(trip_id,user_id,role,invited_by) VALUES
  ('a1000000-0000-7000-8000-00000000000a','b0000000-0000-7000-8000-00000000000b','viewer',
   'a0000000-0000-7000-8000-00000000000a') ON CONFLICT DO NOTHING;
SET ROLE globetrotter_app;
SET app.user_id = 'b0000000-0000-7000-8000-00000000000b';

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trips WHERE id='a1000000-0000-7000-8000-00000000000a'$$,
  '1', 'RLS  invited VIEWER can now read the private trip');

SELECT test.expect_eq(
  $$WITH d AS (DELETE FROM trip_stops
                WHERE trip_id='a1000000-0000-7000-8000-00000000000a' RETURNING 1)
    SELECT count(*)::text FROM d$$,
  '0', 'RLS  VIEWER cannot delete stops (editor role required)');

-- ── Promote to editor ──────────────────────────────────────────────────────
RESET ROLE;
UPDATE trip_collaborators SET role='editor'
 WHERE trip_id='a1000000-0000-7000-8000-00000000000a'
   AND user_id='b0000000-0000-7000-8000-00000000000b';
SET ROLE globetrotter_app;
SET app.user_id = 'b0000000-0000-7000-8000-00000000000b';

SELECT test.expect_ok(
  $$INSERT INTO trip_stops(trip_id,city_id,seq,period)
    VALUES ('a1000000-0000-7000-8000-00000000000a','33333333-3333-7333-8333-333333333333',
            2,'[2026-10-04 00:00+00,2026-10-06 00:00+00)')$$,
  'RLS  EDITOR can add a stop');

SELECT test.expect_error(
  $$INSERT INTO trip_collaborators(trip_id,user_id,role)
    VALUES ('a1000000-0000-7000-8000-00000000000a',
            'c0000000-0000-7000-8000-00000000000c','editor')$$,
  '42501', 'RLS  EDITOR cannot invite further collaborators (owner-only)');

-- ── Anonymous ──────────────────────────────────────────────────────────────
SET app.user_id = '';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trips WHERE id='a1000000-0000-7000-8000-00000000000a'$$,
  '0', 'RLS  anonymous cannot read a private trip');
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trips WHERE id='a2000000-0000-7000-8000-00000000000a'$$,
  '1', 'RLS  anonymous CAN read a public trip');

-- ── Admin override ─────────────────────────────────────────────────────────
SET app.user_id = 'c0000000-0000-7000-8000-00000000000c';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM trips WHERE id='a1000000-0000-7000-8000-00000000000a'$$,
  '1', 'RLS  admin can read any trip');

-- ── The API must not be able to rewrite schema history ─────────────────────
SELECT test.expect_error($$DELETE FROM schema_migrations$$, '42501',
  'RLS  app role cannot touch schema_migrations');

RESET ROLE;
SELECT test.report();
