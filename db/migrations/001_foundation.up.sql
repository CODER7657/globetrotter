-- ============================================================================
-- 001_foundation — extensions, enums, shared helpers, reference data
-- ============================================================================
-- Design notes:
--   * Every PK is uuidv7() (PostgreSQL 18 native). Timestamp-ordered, so index
--     locality is as good as a bigserial, without leaking row counts.
--   * All money is NUMERIC(12,2) paired with an ISO-4217 code. Never float.
--   * All instants are TIMESTAMPTZ. All spans are TSTZRANGE.
--   * app.current_user_id() is the single seam between the API and RLS.
-- ============================================================================

-- Helpers and the RLS seam live in their own schema so `public` stays purely
-- data. Nothing in `app` is directly reachable by the API role's default path.
CREATE SCHEMA IF NOT EXISTS app;

CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- required: scalar = inside EXCLUDE
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- typo-tolerant search
CREATE EXTENSION IF NOT EXISTS unaccent;    -- "málaga" matches "malaga"
CREATE EXTENSION IF NOT EXISTS vector;      -- installed now, populated post-event

-- ---------------------------------------------------------------- enums ----
CREATE TYPE user_role         AS ENUM ('traveler', 'admin');
CREATE TYPE trip_status       AS ENUM ('draft', 'planned', 'active', 'completed', 'archived');
CREATE TYPE trip_visibility   AS ENUM ('private', 'unlisted', 'public');
CREATE TYPE collaborator_role AS ENUM ('viewer', 'editor');
CREATE TYPE cost_category     AS ENUM ('transport', 'stay', 'activity', 'meal', 'other');
CREATE TYPE transport_mode    AS ENUM ('flight', 'train', 'bus', 'car', 'ferry', 'walk', 'other');

-- ------------------------------------------------------------- helpers ----

-- Returns the user id the API pinned onto this transaction, or NULL when the
-- request is anonymous. Every RLS policy funnels through this one function, so
-- there is exactly one place to audit.
CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- app.is_admin() lives in 002, after users exists: a SQL-language function body
-- is parsed and resolved at CREATE time, so it cannot forward-reference a table.

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Immutable unaccent wrapper. The stock unaccent() is STABLE, which bars it
-- from generated columns and expression indexes; pinning the dictionary makes
-- it safely IMMUTABLE.
CREATE FUNCTION app.immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- ---------------------------------------------------- reference: money ----
CREATE TABLE currencies (
  code        char(3)     PRIMARY KEY,
  name        text        NOT NULL,
  symbol      text        NOT NULL,
  minor_units smallint    NOT NULL DEFAULT 2 CHECK (minor_units BETWEEN 0 AND 4),
  CONSTRAINT currencies_code_upper CHECK (code = upper(code) AND code ~ '^[A-Z]{3}$')
);
COMMENT ON TABLE currencies IS 'ISO 4217. Referenced by every monetary column so a stray code cannot be stored.';

-- Rates are point-in-time, not a single mutable row: a trip budgeted in March
-- must still reproduce March''s numbers in June.
CREATE TABLE fx_rates (
  base_code   char(3)      NOT NULL REFERENCES currencies(code),
  quote_code  char(3)      NOT NULL REFERENCES currencies(code),
  rate        numeric(18,8) NOT NULL CHECK (rate > 0),
  as_of       date         NOT NULL,
  PRIMARY KEY (base_code, quote_code, as_of),
  CONSTRAINT fx_rates_distinct_pair CHECK (base_code <> quote_code)
);
COMMENT ON TABLE fx_rates IS 'Historical FX. Never overwritten — budgets reproduce the rate as of the day they were computed.';

-- ------------------------------------------------ reference: geography ----
CREATE TABLE countries (
  code        char(2)  PRIMARY KEY,
  name        text     NOT NULL UNIQUE,
  region      text     NOT NULL,
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  visa_note   text,
  CONSTRAINT countries_code_upper CHECK (code = upper(code) AND code ~ '^[A-Z]{2}$')
);

CREATE INDEX countries_region_idx ON countries (region);
