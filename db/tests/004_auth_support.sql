-- ============================================================================
-- 004_auth_support — the login and refresh paths work, and nothing else opened
-- ============================================================================
TRUNCATE test.results;

INSERT INTO users(id,email,password_hash,display_name)
 VALUES ('f0000000-0000-7000-8000-00000000000f','probe@example.test',repeat('$argon2id$',4),'Probe')
 ON CONFLICT DO NOTHING;
INSERT INTO refresh_token_families(id,user_id)
 VALUES ('f1000000-0000-7000-8000-00000000000f','f0000000-0000-7000-8000-00000000000f')
 ON CONFLICT DO NOTHING;
INSERT INTO refresh_tokens(id,family_id,token_hash,expires_at)
 VALUES ('f2000000-0000-7000-8000-00000000000f','f1000000-0000-7000-8000-00000000000f',
         sha256('tok'::bytea), now()+interval '30 days')
 ON CONFLICT DO NOTHING;

SET ROLE globetrotter_app;
SET app.user_id = '';

-- ── login ──────────────────────────────────────────────────────────────────
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM users WHERE email='probe@example.test'$$, '0',
  'AUTH  direct table read still blocked for anonymous (RLS intact)');

SELECT test.expect_eq(
  $$SELECT email::text FROM app.auth_find_user_by_email('probe@example.test')$$,
  'probe@example.test', 'AUTH  login lookup works via the definer function');

SELECT test.expect_eq(
  $$SELECT (length(password_hash) > 0)::text FROM app.auth_find_user_by_email('probe@example.test')$$,
  'true', 'AUTH  login lookup returns the hash to verify against');

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM app.auth_find_user_by_email('nobody@example.test')$$, '0',
  'AUTH  unknown email returns no rows (API must still equalise timing)');

-- ── refresh ────────────────────────────────────────────────────────────────
SELECT test.expect_eq(
  $$SELECT user_id::text FROM app.auth_find_refresh_token(sha256('tok'::bytea))$$,
  'f0000000-0000-7000-8000-00000000000f',
  'AUTH  refresh lookup resolves the owning family');

SELECT test.expect_eq(
  $$SELECT count(*)::text FROM app.auth_find_refresh_token(sha256('wrong'::bytea))$$, '0',
  'AUTH  a token hash that was never issued resolves to nothing');

-- ── signup without a SECURITY DEFINER function ─────────────────────────────
SELECT test.expect_ok(
  $$INSERT INTO users(email,password_hash,display_name)
    VALUES ('plain@example.test',repeat('x',30),'Plain')$$,
  'AUTH  plain signup INSERT succeeds under users_signup');

SELECT test.expect_eq($$
  WITH ins AS (
    SELECT set_config('app.user_id','99999999-9999-7999-8999-999999999999',false)
  ), w AS (
    INSERT INTO users(id,email,password_hash,display_name)
    SELECT '99999999-9999-7999-8999-999999999999','ret@example.test',repeat('x',30),'Ret'
      FROM ins RETURNING id
  ) SELECT count(*)::text FROM w $$, '1',
  'AUTH  INSERT..RETURNING works when app.user_id is preset to the new id');

-- ── the hole is not wider than intended ────────────────────────────────────
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM refresh_token_families$$, '0',
  'AUTH  anonymous still cannot browse token families');

SET app.user_id = 'f0000000-0000-7000-8000-00000000000f';
SELECT test.expect_eq(
  $$SELECT count(*)::text FROM refresh_token_families$$, '1',
  'AUTH  the owner CAN read their own families');

RESET ROLE;

-- ── PUBLIC must not hold EXECUTE on any SECURITY DEFINER function ──────────
SELECT test.expect_eq($$
  SELECT count(*)::text FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='app' AND p.prosecdef
    AND has_function_privilege('public', p.oid, 'EXECUTE') $$,
  '0', 'AUTH  no SECURITY DEFINER function is executable by PUBLIC');

SELECT test.report();
