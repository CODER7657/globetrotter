-- =============================================================================
-- Refresh token families (issue #15)
--
-- 0001 modelled a "family" and a "token" as one row, which cannot express
-- replay detection: to notice that a rotated token was presented twice you
-- need the individual tokens AND the family they belong to.
--
-- The rule this schema exists to enforce:
--   every refresh mints a new token and marks the old one used;
--   presenting an already-used token means it leaked;
--   so the whole family is revoked and the user must log in again.
--
-- NOTE ON RLS: these tables carry no policies on purpose. They are read
-- *before* the caller has an identity -- during refresh there is no
-- app.user_id yet -- so an RLS policy keyed on it could never match.
-- Authorization here is possession of an unguessable token, checked in SQL.
-- =============================================================================

DROP TABLE IF EXISTS refresh_token_families;

CREATE TYPE token_revoke_reason AS ENUM (
  'logout',
  'replay_detected',
  'password_changed',
  'admin_revoked'
);

CREATE TABLE refresh_token_families (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at     timestamptz,
  revoked_reason token_revoke_reason,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A family is either live, or revoked with a stated reason. Never half of each.
  CONSTRAINT refresh_token_families_revocation_complete
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE INDEX refresh_token_families_user_id_idx ON refresh_token_families (user_id);

COMMENT ON TABLE refresh_token_families IS
  'One family per login session. Revoking a family invalidates every token descended from it (issue #15).';
COMMENT ON COLUMN refresh_token_families.revoked_reason IS
  'replay_detected means a rotated token was presented a second time -- treat as compromise.';

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  family_id   uuid NOT NULL REFERENCES refresh_token_families(id) ON DELETE CASCADE,
  -- SHA-256 of the token. The plaintext exists only in the user's cookie, so
  -- a database leak yields nothing usable.
  token_hash  text NOT NULL UNIQUE,
  used_at     timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refresh_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

-- Covering index on the FK: replay detection revokes a family by walking it.
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
-- Lookup on every refresh is by hash; UNIQUE already provides the index.

COMMENT ON TABLE refresh_tokens IS
  'One row per issued refresh token. used_at IS NOT NULL means it was already rotated (issue #15).';
COMMENT ON COLUMN refresh_tokens.replaced_by IS
  'The token minted when this one was rotated. Gives an audit chain through the family.';
