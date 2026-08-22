-- ============================================================================
-- 008_auth_support — the two lookups authentication cannot do under RLS
-- ============================================================================
-- Found by @Ayush3422 in #47, and it is a genuine gap in 005.
--
-- Authentication runs BEFORE an identity exists, so it cannot satisfy policies
-- keyed on app.current_user_id(). Two flows are structurally impossible:
--
--   LOGIN    users_self_read is USING (id = app.current_user_id()), and the id
--            is precisely what login is trying to discover. Chicken-and-egg.
--
--   REFRESH  refresh_tokens is USING (true) — the token hash IS the capability —
--            but rtf_owner on refresh_token_families is keyed on user_id, which
--            is unknown until that row has been read.
--
-- The fix is two narrow SECURITY DEFINER functions. Each REQUIRES a credential
-- the caller must already possess (an email being probed, or 256 bits of token
-- hash), so neither widens what an anonymous connection can discover by
-- browsing. They are the smallest holes that make the flows possible.
--
-- SIGNUP does NOT need one, contrary to #47. A plain INSERT already succeeds
-- under users_signup. Only `INSERT ... RETURNING` fails, because RETURNING
-- needs a SELECT policy to match — and the API can simply generate the uuidv7
-- client-side (apps/api/src/db/uuid.ts already does) and set app.user_id to it
-- before inserting. Verified working. A third SECURITY DEFINER function to
-- avoid one line of application code would be a bad trade.
-- ============================================================================

CREATE FUNCTION app.auth_find_user_by_email(p_email citext)
RETURNS TABLE (
  id                uuid,
  email             citext,
  password_hash     text,
  display_name      text,
  role              user_role,
  home_currency     char(3),
  email_verified_at timestamptz,
  created_at        timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT u.id, u.email, u.password_hash, u.display_name, u.role,
         u.home_currency, u.email_verified_at, u.created_at
    FROM users u
   WHERE u.email = p_email
     AND u.deleted_at IS NULL
$$;

COMMENT ON FUNCTION app.auth_find_user_by_email IS
  'Login path only. Returns the Argon2id hash, so the API must compare in constant time and '
  'must return an identical response for unknown-user and wrong-password. Never call from a '
  'route that reflects existence back to the caller.';

CREATE FUNCTION app.auth_find_refresh_token(p_hash bytea)
RETURNS TABLE (
  token_id          uuid,
  family_id         uuid,
  user_id           uuid,
  consumed_at       timestamptz,
  expires_at        timestamptz,
  family_revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT rt.id, rt.family_id, f.user_id, rt.consumed_at, rt.expires_at, f.revoked_at
    FROM refresh_tokens rt
    JOIN refresh_token_families f ON f.id = rt.family_id
   WHERE rt.token_hash = p_hash
$$;

COMMENT ON FUNCTION app.auth_find_refresh_token IS
  'Refresh path only. The token hash is the capability. A non-null consumed_at means replay: '
  'revoke the whole family, do not issue.';

-- ⚠️ CRITICAL, and missing from the version proposed in #47.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. On a
-- SECURITY DEFINER function that reads password hashes, that would hand every
-- role on the cluster a way to read them — exactly inverting the point of the
-- least-privilege role added in 005. Revoke first, then grant deliberately.
REVOKE ALL ON FUNCTION app.auth_find_user_by_email(citext) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_find_refresh_token(bytea)  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.auth_find_user_by_email(citext) TO globetrotter_app;
GRANT EXECUTE ON FUNCTION app.auth_find_refresh_token(bytea)  TO globetrotter_app;

-- The same default applies to the predicates added in 005. Close them too.
REVOKE ALL ON FUNCTION app.is_admin()            FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_read_trip(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_edit_trip(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION app.stop_trip(uuid)       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.is_admin()          TO globetrotter_app;
GRANT EXECUTE ON FUNCTION app.can_read_trip(uuid) TO globetrotter_app;
GRANT EXECUTE ON FUNCTION app.can_edit_trip(uuid) TO globetrotter_app;
GRANT EXECUTE ON FUNCTION app.stop_trip(uuid)     TO globetrotter_app;

-- Login and refresh both need to write the session tables before an identity is
-- established on the transaction. rtf_owner covers reads correctly; these two
-- policies let the token machinery bootstrap.
DROP POLICY IF EXISTS rtf_owner ON refresh_token_families;

CREATE POLICY rtf_read ON refresh_token_families FOR SELECT
  USING (user_id = app.current_user_id() OR app.is_admin());

-- A family row is created during login, when app.user_id is not yet set. The
-- FK to users is what keeps this honest: you cannot invent a family for a user
-- that does not exist.
CREATE POLICY rtf_insert ON refresh_token_families FOR INSERT
  WITH CHECK (true);

-- Rotation and replay-revocation happen while the identity IS known (it comes
-- out of auth_find_refresh_token), so updates stay owner-scoped.
CREATE POLICY rtf_update ON refresh_token_families FOR UPDATE
  USING (user_id = app.current_user_id() OR app.is_admin())
  WITH CHECK (user_id = app.current_user_id() OR app.is_admin());

CREATE POLICY rtf_delete ON refresh_token_families FOR DELETE
  USING (user_id = app.current_user_id() OR app.is_admin());
