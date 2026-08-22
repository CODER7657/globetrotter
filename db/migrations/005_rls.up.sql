-- ============================================================================
-- 005_rls — authorization lives in the database
-- ============================================================================
-- Credit: @Ayush3422 found the load-bearing half of this in #44. His integration
-- test showed user B reading user A's private trip while every policy looked
-- correct. The policies were correct; the CONNECTION was not.
--
--   Row-Level Security is silently skipped for superusers and for any role with
--   BYPASSRLS. POSTGRES_USER is a superuser. An API connecting as it therefore
--   has no authorization at all, no matter how many policies exist.
--
-- So this migration does two things, and both are required:
--   1. creates globetrotter_app — NOSUPERUSER, NOBYPASSRLS, owns nothing
--   2. enables FORCE RLS and defines the policies
--
-- FORCE (not just ENABLE) matters: without it the table OWNER also bypasses.
--
-- Note on his version: ALTER DEFAULT PRIVILEGES only affects objects created
-- AFTER it runs, so it could not cover the 19 tables from 001–004 that already
-- exist. Grants here are explicit; the default-privileges line is kept only for
-- tables added by future migrations.
-- ============================================================================

-- ------------------------------------------------------- the app role -----
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'globetrotter_app') THEN
    -- Local password only. Production provisions this role out of band; a
    -- credential never comes from a migration file.
    CREATE ROLE globetrotter_app
      LOGIN PASSWORD 'globetrotter_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$do$;

COMMENT ON ROLE globetrotter_app IS
  'API connection role. NOBYPASSRLS is load-bearing: RLS is the authorization layer.';

GRANT USAGE ON SCHEMA public, app TO globetrotter_app;

-- Catalog is read-only to the API. It is mutated by seed and by admin tooling,
-- never by a request handler.
GRANT SELECT ON
  currencies, fx_rates, countries, cities, city_cost_index,
  activity_categories, activities, activity_schedules
TO globetrotter_app;

-- User data is read/write, gated by the policies below.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, refresh_token_families, refresh_tokens,
  trips, trip_stops, trip_activities, trip_collaborators, trip_shares
TO globetrotter_app;

-- schema_migrations is deliberately NOT granted: the API cannot rewrite its own
-- schema history.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO globetrotter_app;

-- ------------------------------------------- access predicates (helpers) --
-- SECURITY DEFINER so these can consult trip_collaborators without triggering
-- that table's own policies — otherwise a policy that reads the table it is
-- protecting recurses. search_path is pinned to block hijacking.

CREATE FUNCTION app.can_read_trip(p_trip uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips t
     WHERE t.id = p_trip
       AND t.deleted_at IS NULL
       AND (
            t.owner_id = app.current_user_id()
         OR t.visibility = 'public'
         OR EXISTS (SELECT 1 FROM trip_collaborators c
                     WHERE c.trip_id = t.id AND c.user_id = app.current_user_id())
         -- Unlisted trips are reachable only by presenting a live share slug,
         -- which the API pins onto the transaction the same way it pins user id.
         OR (t.visibility = 'unlisted' AND EXISTS (
              SELECT 1 FROM trip_shares s
               WHERE s.trip_id = t.id
                 AND s.revoked_at IS NULL
                 AND s.slug = NULLIF(current_setting('app.share_slug', true), '')))
       )
  ) OR app.is_admin()
$$;

CREATE FUNCTION app.can_edit_trip(p_trip uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips t
     WHERE t.id = p_trip
       AND t.deleted_at IS NULL
       AND (
            t.owner_id = app.current_user_id()
         OR EXISTS (SELECT 1 FROM trip_collaborators c
                     WHERE c.trip_id = t.id
                       AND c.user_id = app.current_user_id()
                       AND c.role = 'editor')
       )
  ) OR app.is_admin()
$$;

CREATE FUNCTION app.stop_trip(p_stop uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT trip_id FROM trip_stops WHERE id = p_stop
$$;

-- --------------------------------------------------------------- users ----
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE  ROW LEVEL SECURITY;

CREATE POLICY users_self_read ON users FOR SELECT
  USING (id = app.current_user_id() OR app.is_admin());

CREATE POLICY users_self_write ON users FOR UPDATE
  USING (id = app.current_user_id() OR app.is_admin())
  WITH CHECK (id = app.current_user_id() OR app.is_admin());

-- Signup happens before a session exists, so INSERT cannot be gated on identity.
-- The uniqueness and CHECK constraints from 002 are what protect this path.
CREATE POLICY users_signup ON users FOR INSERT WITH CHECK (true);

-- ------------------------------------------------------------- sessions ---
ALTER TABLE refresh_token_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_token_families FORCE  ROW LEVEL SECURITY;
CREATE POLICY rtf_owner ON refresh_token_families FOR ALL
  USING (user_id = app.current_user_id() OR app.is_admin())
  WITH CHECK (user_id = app.current_user_id());

-- Refresh tokens are looked up by hash BEFORE the user is known, so the SELECT
-- path cannot be identity-gated. The token hash itself is the capability, and
-- it is 256 bits of entropy the client must already possess.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE  ROW LEVEL SECURITY;
CREATE POLICY rt_all ON refresh_tokens FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------- trips ---
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips FORCE  ROW LEVEL SECURITY;

CREATE POLICY trips_read ON trips FOR SELECT USING (app.can_read_trip(id));

CREATE POLICY trips_insert ON trips FOR INSERT
  WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY trips_update ON trips FOR UPDATE
  USING (owner_id = app.current_user_id() OR app.is_admin())
  WITH CHECK (owner_id = app.current_user_id() OR app.is_admin());

CREATE POLICY trips_delete ON trips FOR DELETE
  USING (owner_id = app.current_user_id() OR app.is_admin());

-- ------------------------------------------------------------- the graph --
ALTER TABLE trip_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stops FORCE  ROW LEVEL SECURITY;
CREATE POLICY trip_stops_read  ON trip_stops FOR SELECT USING (app.can_read_trip(trip_id));
CREATE POLICY trip_stops_write ON trip_stops FOR ALL
  USING (app.can_edit_trip(trip_id)) WITH CHECK (app.can_edit_trip(trip_id));

ALTER TABLE trip_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_activities FORCE  ROW LEVEL SECURITY;
CREATE POLICY trip_activities_read  ON trip_activities FOR SELECT
  USING (app.can_read_trip(app.stop_trip(stop_id)));
CREATE POLICY trip_activities_write ON trip_activities FOR ALL
  USING (app.can_edit_trip(app.stop_trip(stop_id)))
  WITH CHECK (app.can_edit_trip(app.stop_trip(stop_id)));

ALTER TABLE trip_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_collaborators FORCE  ROW LEVEL SECURITY;
CREATE POLICY trip_collaborators_read ON trip_collaborators FOR SELECT
  USING (user_id = app.current_user_id() OR app.can_read_trip(trip_id));
-- Only the trip OWNER manages the collaborator list — an editor cannot invite
-- more editors or escalate themselves.
CREATE POLICY trip_collaborators_write ON trip_collaborators FOR ALL
  USING      (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.owner_id = app.current_user_id()) OR app.is_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.owner_id = app.current_user_id()) OR app.is_admin());

ALTER TABLE trip_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_shares FORCE  ROW LEVEL SECURITY;
CREATE POLICY trip_shares_read ON trip_shares FOR SELECT
  USING (slug = NULLIF(current_setting('app.share_slug', true), '') OR app.can_read_trip(trip_id));
CREATE POLICY trip_shares_write ON trip_shares FOR ALL
  USING      (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.owner_id = app.current_user_id()) OR app.is_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.owner_id = app.current_user_id()) OR app.is_admin());
