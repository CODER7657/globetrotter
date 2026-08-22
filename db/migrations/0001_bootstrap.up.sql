-- =============================================================================
-- PROVISIONAL BOOTSTRAP MIGRATION  (issue #13, backend skeleton)
--
-- This is NOT the real schema. @pavan's issue #1 defines the authoritative
-- 19-table design and SUPERSEDES this file wholesale. This exists only so the
-- Fastify skeleton, withTx() and the RLS session variable can be proven to
-- work end-to-end before #1 lands.
--
-- Conventions here deliberately match #1 so the swap is mechanical:
--   uuidv7() PKs, citext email, TIMESTAMPTZ everywhere, NUMERIC(12,2) money,
--   native enums (never status VARCHAR), CHECK on every bounded value,
--   covering index on every FK, COMMENT ON every table.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- --- enums -------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE trip_visibility AS ENUM ('private', 'unlisted', 'public');

-- --- users -------------------------------------------------------------------
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  email             citext NOT NULL UNIQUE,
  password_hash     text NOT NULL,
  display_name      text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  role              user_role NOT NULL DEFAULT 'user',
  email_verified_at timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS 'Account records. Soft-deleted via deleted_at; rows are never hard-deleted (issue #21).';
COMMENT ON COLUMN users.password_hash IS 'Argon2id encoded hash (m=19456,t=2,p=1). Never leaves the repository layer.';
COMMENT ON COLUMN users.email IS 'citext so uniqueness is case-insensitive without a functional index.';

-- --- refresh token families (issue #15) --------------------------------------
CREATE TABLE refresh_token_families (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  revoked_at  timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

-- Covering index on the FK: every revocation sweeps a whole family by user.
CREATE INDEX refresh_token_families_user_id_idx ON refresh_token_families (user_id);

COMMENT ON TABLE refresh_token_families IS
  'One row per issued refresh token. Replay of a rotated token revokes the entire family (issue #15).';

-- --- reference stubs ---------------------------------------------------------
-- Minimal stand-ins so the FKs below are real. Issue #1 replaces these with
-- the full countries/cities/city_cost_index/activity_categories hierarchy.
CREATE TABLE cities (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  name         text NOT NULL,
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cities IS 'PROVISIONAL stub. Superseded by issue #1.';

CREATE TABLE activities (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  city_id    uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activities_city_id_idx ON activities (city_id);

COMMENT ON TABLE activities IS 'PROVISIONAL stub. Superseded by issue #1.';

-- --- trips -------------------------------------------------------------------
CREATE TABLE trips (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description     text CHECK (length(description) <= 2000),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  cover_image_url text,
  visibility      trip_visibility NOT NULL DEFAULT 'private',
  -- Optimistic concurrency token (issue #17). Bumped by trg_trips_version.
  version         integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_date_order CHECK (end_date >= start_date)
);

CREATE INDEX trips_owner_id_idx ON trips (owner_id);

COMMENT ON TABLE trips IS 'A multi-city trip. Authorization is enforced by RLS below, not by application code (issue #4).';
COMMENT ON COLUMN trips.version IS 'Incremented on every UPDATE; If-Match mismatches return 409 (issue #17).';

-- --- trip_stops --------------------------------------------------------------
CREATE TABLE trip_stops (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  city_id        uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  position       integer NOT NULL CHECK (position >= 0),
  arrival_date   date NOT NULL,
  departure_date date NOT NULL,
  notes          text CHECK (length(notes) <= 2000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_stops_date_order CHECK (departure_date >= arrival_date),
  -- DEFERRABLE so a whole-list reorder can shuffle positions inside one
  -- transaction without tripping the constraint mid-statement (issue #17).
  CONSTRAINT trip_stops_position_unique UNIQUE (trip_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX trip_stops_trip_id_idx ON trip_stops (trip_id);
CREATE INDEX trip_stops_city_id_idx ON trip_stops (city_id);

COMMENT ON TABLE trip_stops IS 'Ordered cities within a trip. ON DELETE RESTRICT on city_id: a city in use cannot be removed.';

-- --- trip_activities ---------------------------------------------------------
CREATE TABLE trip_activities (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  stop_id       uuid NOT NULL REFERENCES trip_stops(id) ON DELETE CASCADE,
  activity_id   uuid NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  cost_amount   numeric(12,2) CHECK (cost_amount >= 0),
  currency_code char(3) CHECK (currency_code ~ '^[A-Z]{3}$'),
  notes         text CHECK (length(notes) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_activities_time_order CHECK (ends_at > starts_at),
  -- Money is never half-specified: either both columns or neither.
  CONSTRAINT trip_activities_cost_complete
    CHECK ((cost_amount IS NULL) = (currency_code IS NULL))
);

CREATE INDEX trip_activities_stop_id_idx ON trip_activities (stop_id);
CREATE INDEX trip_activities_activity_id_idx ON trip_activities (activity_id);

COMMENT ON TABLE trip_activities IS 'A scheduled activity inside a stop. Cost stored as NUMERIC + ISO-4217 code, never float.';

-- --- version bump trigger ----------------------------------------------------
CREATE FUNCTION bump_trip_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_trips_version
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION bump_trip_version();

-- =============================================================================
-- Row-Level Security (issue #4 — authorization lives in the database)
--
-- withTx() sets `app.user_id` on the connection for the life of the
-- transaction. FORCE is required because the API connects as the table owner,
-- which is otherwise exempt from its own policies.
-- =============================================================================

CREATE FUNCTION current_app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$fn$;

COMMENT ON FUNCTION current_app_user_id() IS
  'Reads the per-transaction identity set by withTx(). NULL when unauthenticated.';

ALTER TABLE trips            ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips            FORCE  ROW LEVEL SECURITY;
ALTER TABLE trip_stops       ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stops       FORCE  ROW LEVEL SECURITY;
ALTER TABLE trip_activities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_activities  FORCE  ROW LEVEL SECURITY;

-- A trip is visible to its owner, or to anyone if it is not private.
CREATE POLICY trips_select ON trips FOR SELECT
  USING (owner_id = current_app_user_id() OR visibility <> 'private');

CREATE POLICY trips_insert ON trips FOR INSERT
  WITH CHECK (owner_id = current_app_user_id());

CREATE POLICY trips_update ON trips FOR UPDATE
  USING (owner_id = current_app_user_id())
  WITH CHECK (owner_id = current_app_user_id());

CREATE POLICY trips_delete ON trips FOR DELETE
  USING (owner_id = current_app_user_id());

-- Stops and activities inherit their trip's visibility. Expressed as EXISTS
-- against trips, which re-applies the policies above.
CREATE POLICY trip_stops_all ON trip_stops FOR ALL
  USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_stops.trip_id))
  WITH CHECK (EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = trip_stops.trip_id AND t.owner_id = current_app_user_id()
  ));

CREATE POLICY trip_activities_all ON trip_activities FOR ALL
  USING (EXISTS (
    SELECT 1 FROM trip_stops s WHERE s.id = trip_activities.stop_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM trip_stops s JOIN trips t ON t.id = s.trip_id
    WHERE s.id = trip_activities.stop_id AND t.owner_id = current_app_user_id()
  ));
