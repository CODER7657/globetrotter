-- =============================================================================
-- Least-privilege application role (issue #4)
--
-- WHY THIS EXISTS, in one sentence: Row-Level Security is silently bypassed
-- for superusers and for roles with BYPASSRLS, and POSTGRES_USER is a
-- superuser -- so an API connecting as it has NO authorization at all, even
-- with ENABLE/FORCE ROW LEVEL SECURITY set on every table.
--
-- An integration test caught exactly this: user B could read user A's private
-- trip and every policy looked correct. The policies were correct; the
-- connection was not.
--
-- The API therefore connects as globetrotter_app: NOSUPERUSER, NOBYPASSRLS,
-- and not the owner of any table.
-- =============================================================================

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'globetrotter_app') THEN
    -- Local/dev password. Production provisions this role out-of-band and
    -- never takes the credential from a migration file.
    CREATE ROLE globetrotter_app
      LOGIN PASSWORD 'globetrotter_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$do$;

GRANT USAGE ON SCHEMA public TO globetrotter_app;

-- Explicit per-table grants rather than ALL TABLES: the migration ledger is
-- deliberately excluded, so the API cannot rewrite its own schema history.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users,
  refresh_token_families,
  cities,
  activities,
  trips,
  trip_stops,
  trip_activities
TO globetrotter_app;

-- Tables added by later migrations (issue #1) inherit these grants, so nobody
-- has to remember to come back here.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO globetrotter_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO globetrotter_app;

COMMENT ON ROLE globetrotter_app IS
  'API connection role. NOBYPASSRLS is load-bearing: RLS is the authorization layer.';
