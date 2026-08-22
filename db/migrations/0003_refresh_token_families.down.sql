-- Down migration for 0003_refresh_token_families.
-- Restores the provisional single-table shape from 0001 so the ledger stays
-- consistent if this migration is reverted.
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS refresh_token_families;
DROP TYPE IF EXISTS token_revoke_reason;

CREATE TABLE refresh_token_families (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  revoked_at  timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX refresh_token_families_user_id_idx ON refresh_token_families (user_id);
