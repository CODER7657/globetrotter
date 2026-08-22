-- ============================================================================
-- 002_identity — users, refresh-token families, sessions
-- ============================================================================
-- Refresh tokens use the "token family" model. A family is one login. Each
-- refresh mints a new token and retires the previous one. If a retired token is
-- ever presented again it means the cookie was stolen and replayed, so the
-- entire family is revoked, not just that token. Storing hashes (never the raw
-- token) means a database dump cannot be used to log in as anyone.
-- ============================================================================

CREATE TABLE users (
  id              uuid        PRIMARY KEY DEFAULT uuidv7(),
  email           citext      NOT NULL,
  password_hash   text        NOT NULL,
  display_name    text        NOT NULL,
  avatar_url      text,
  role            user_role   NOT NULL DEFAULT 'traveler',
  home_currency   char(3)     NOT NULL DEFAULT 'USD' REFERENCES currencies(code),
  locale          text        NOT NULL DEFAULT 'en',
  email_verified_at timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  -- Shape check only. Deliverability is the application''s job; this exists so
  -- a malformed address can never reach the table by any path.
  CONSTRAINT users_email_shape   CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  CONSTRAINT users_email_len     CHECK (length(email) BETWEEN 6 AND 254),
  CONSTRAINT users_display_name  CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT users_locale_shape  CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT users_avatar_scheme CHECK (avatar_url IS NULL OR avatar_url ~ '^https?://'),
  CONSTRAINT users_hash_present  CHECK (length(password_hash) >= 20)
);

-- Soft-deleted accounts free their address for re-registration, so uniqueness
-- is partial rather than a plain UNIQUE.
CREATE UNIQUE INDEX users_email_active_uq ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_role_idx ON users (role) WHERE deleted_at IS NULL;

COMMENT ON TABLE  users IS 'Accounts. Soft-deleted via deleted_at so trips and audit rows keep a valid FK.';
COMMENT ON COLUMN users.password_hash IS 'Argon2id PHC string. Never bcrypt, never a bare digest.';

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Defined here rather than in 001 because a SQL-language function body is
-- resolved at CREATE time and therefore cannot forward-reference users.
-- SECURITY DEFINER so an RLS policy can consult it without the caller needing
-- read access to other users' rows; search_path is pinned to block hijacking.
CREATE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = app.current_user_id()
       AND role = 'admin'
       AND deleted_at IS NULL
  )
$$;

-- --------------------------------------------------------- token families --
CREATE TABLE refresh_token_families (
  id           uuid        PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent   text,
  ip_address   inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoked_reason text,
  CONSTRAINT rtf_revoke_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX rtf_user_active_idx ON refresh_token_families (user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE refresh_token_families IS 'One row per login. Revoking the family kills every descendant token at once.';

CREATE TABLE refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  family_id   uuid        NOT NULL REFERENCES refresh_token_families(id) ON DELETE CASCADE,
  token_hash  bytea       NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT refresh_tokens_ttl CHECK (expires_at > issued_at)
);
CREATE UNIQUE INDEX refresh_tokens_hash_uq ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id, issued_at DESC);

COMMENT ON COLUMN refresh_tokens.token_hash IS 'sha256 of the raw token. The raw value exists only in the client cookie.';
COMMENT ON COLUMN refresh_tokens.consumed_at IS 'Set on rotation. Presenting a consumed token is a replay — revoke the family.';
