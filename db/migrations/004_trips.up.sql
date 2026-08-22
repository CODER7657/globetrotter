-- ============================================================================
-- 004_trips — itineraries, and the constraints that make bad ones unstorable
-- ============================================================================
-- THE CORE CLAIM OF THIS PROJECT:
--   An impossible itinerary is not "rejected by validation". It has no
--   representation in this schema. Three guarantees, all enforced by indexes:
--
--   1. Within one trip, two stops cannot overlap in time.
--        -> EXCLUDE USING gist (trip_id WITH =, period WITH &&)
--   2. Within one stop, two activities cannot occupy the same slot.
--        -> EXCLUDE USING gist (stop_id WITH =, slot WITH &&)
--   3. An activity cannot be scheduled outside the stop it belongs to.
--        -> temporal FOREIGN KEY (stop_id, PERIOD slot) REFERENCES ... (id, PERIOD period)
--
--   (3) is the one almost nobody uses: a *referential* constraint over time.
--   Deleting or shrinking a stop out from under a scheduled activity is refused
--   by the same machinery that refuses a dangling FK.
-- ============================================================================

CREATE TABLE trips (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  owner_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  description   text,
  period        daterange   NOT NULL,
  status        trip_status NOT NULL DEFAULT 'draft',
  visibility    trip_visibility NOT NULL DEFAULT 'private',
  base_currency char(3)     NOT NULL REFERENCES currencies(code),
  budget_cap    numeric(12,2) CHECK (budget_cap IS NULL OR budget_cap > 0),
  cover_image_url text,
  version       integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT trips_name_len      CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT trips_desc_len      CHECK (description IS NULL OR length(description) <= 4000),
  -- A range must be bounded on both sides and non-empty. '[)' by convention.
  CONSTRAINT trips_period_bounded CHECK (
    NOT isempty(period) AND lower(period) IS NOT NULL AND upper(period) IS NOT NULL
  ),
  CONSTRAINT trips_period_sane   CHECK (upper(period) - lower(period) BETWEEN 1 AND 366),
  CONSTRAINT trips_cover_scheme  CHECK (cover_image_url IS NULL OR cover_image_url ~ '^https?://'),
  CONSTRAINT trips_version_pos   CHECK (version > 0)
);

-- Convenience projections for the API. VIRTUAL costs no storage and cannot go
-- stale, because it is computed on read.
ALTER TABLE trips
  ADD COLUMN start_date date GENERATED ALWAYS AS (lower(period)) VIRTUAL,
  ADD COLUMN end_date   date GENERATED ALWAYS AS (upper(period)) VIRTUAL;

-- A traveller cannot be on two committed trips at once. Drafts are exempt:
-- comparing alternative plans for the same week is a legitimate thing to do.
ALTER TABLE trips ADD CONSTRAINT trips_owner_no_overlap
  EXCLUDE USING gist (owner_id WITH =, period WITH &&)
  WHERE (status IN ('planned', 'active') AND deleted_at IS NULL);

CREATE INDEX trips_owner_idx      ON trips (owner_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX trips_visibility_idx ON trips (visibility) WHERE visibility <> 'private' AND deleted_at IS NULL;

COMMENT ON TABLE  trips IS 'One planned journey. period is the source of truth; start_date/end_date are virtual projections.';
COMMENT ON COLUMN trips.version IS 'Optimistic concurrency token. Bumped by trigger on every mutation of the trip graph.';

CREATE TRIGGER trips_touch BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ------------------------------------------------------------ trip stops --
CREATE TABLE trip_stops (
  id             uuid      NOT NULL DEFAULT uuidv7(),
  trip_id        uuid      NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  city_id        uuid      NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  seq            integer   NOT NULL,
  period         tstzrange NOT NULL,
  arrival_mode   transport_mode,
  arrival_cost   numeric(12,2) NOT NULL DEFAULT 0 CHECK (arrival_cost >= 0),
  lodging_cost   numeric(12,2) NOT NULL DEFAULT 0 CHECK (lodging_cost >= 0),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trip_stops_seq_pos     CHECK (seq > 0),
  CONSTRAINT trip_stops_notes_len   CHECK (notes IS NULL OR length(notes) <= 2000),
  CONSTRAINT trip_stops_period_bounded CHECK (
    NOT isempty(period) AND lower(period) IS NOT NULL AND upper(period) IS NOT NULL
  ),
  CONSTRAINT trip_stops_period_sane CHECK (upper(period) - lower(period) <= interval '90 days'),

  -- Temporal PK. Also the target of the temporal FK from trip_activities.
  CONSTRAINT trip_stops_pk PRIMARY KEY (id, period WITHOUT OVERLAPS),

  -- GUARANTEE 1: you cannot be in two cities at once.
  CONSTRAINT trip_stops_no_overlap
    EXCLUDE USING gist (trip_id WITH =, period WITH &&)
);

-- DEFERRABLE is a constraint property, not an index one — and it is required
-- here: reordering stops swaps seq values within a single transaction, which
-- transiently duplicates a value before the swap completes.
ALTER TABLE trip_stops ADD CONSTRAINT trip_stops_trip_seq_uq
  UNIQUE (trip_id, seq) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX trip_stops_trip_idx ON trip_stops (trip_id, period);
CREATE INDEX trip_stops_city_idx ON trip_stops (city_id);

COMMENT ON CONSTRAINT trip_stops_no_overlap ON trip_stops IS
  'Concurrency-safe by construction. Two simultaneous transactions cannot both insert an overlapping stop.';

CREATE TRIGGER trip_stops_touch BEFORE UPDATE ON trip_stops
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ------------------------------------------------------- trip activities --
CREATE TABLE trip_activities (
  id           uuid      NOT NULL DEFAULT uuidv7(),
  stop_id      uuid      NOT NULL,
  activity_id  uuid      REFERENCES activities(id) ON DELETE SET NULL,
  title        text      NOT NULL,
  slot         tstzrange NOT NULL,
  category     cost_category NOT NULL DEFAULT 'activity',
  cost_amount  numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trip_activities_title_len CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT trip_activities_notes_len CHECK (notes IS NULL OR length(notes) <= 2000),
  CONSTRAINT trip_activities_slot_bounded CHECK (
    NOT isempty(slot) AND lower(slot) IS NOT NULL AND upper(slot) IS NOT NULL
  ),
  CONSTRAINT trip_activities_slot_sane CHECK (upper(slot) - lower(slot) <= interval '24 hours'),

  CONSTRAINT trip_activities_pk PRIMARY KEY (id, slot WITHOUT OVERLAPS),

  -- GUARANTEE 2: no double-booking inside a single stop.
  CONSTRAINT trip_activities_no_double_book
    EXCLUDE USING gist (stop_id WITH =, slot WITH &&),

  -- GUARANTEE 3: the slot must lie inside the parent stop's period.
  CONSTRAINT trip_activities_within_stop
    FOREIGN KEY (stop_id, PERIOD slot) REFERENCES trip_stops (id, PERIOD period)
);

CREATE INDEX trip_activities_stop_idx     ON trip_activities (stop_id, slot);
CREATE INDEX trip_activities_activity_idx ON trip_activities (activity_id);

COMMENT ON CONSTRAINT trip_activities_within_stop ON trip_activities IS
  'Temporal foreign key. Containment in the parent stop is referential integrity, not a service-layer check.';

CREATE TRIGGER trip_activities_touch BEFORE UPDATE ON trip_activities
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- PostgreSQL 18 supports only NO ACTION and RESTRICT as referential actions on
-- a temporal (PERIOD) foreign key — ON DELETE CASCADE and ON UPDATE CASCADE are
-- both rejected at DDL time. Verified against 18.6; see docs/adr/0001.
--
-- Without this trigger, deleting a trip fails: the cascade reaches trip_stops,
-- which is then blocked by the temporal FK from trip_activities. So we delete
-- the children explicitly, BEFORE the constraint is evaluated.
--
-- Note this deliberately does NOT extend to UPDATE. Shrinking a stop out from
-- under a scheduled activity stays blocked — silently deleting someone's plans
-- because they trimmed a date is worse than a clear error.
CREATE FUNCTION app.cascade_delete_stop_activities() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM trip_activities WHERE stop_id = OLD.id;
  RETURN OLD;
END
$$;

CREATE TRIGGER trip_stops_cascade_activities
  BEFORE DELETE ON trip_stops
  FOR EACH ROW EXECUTE FUNCTION app.cascade_delete_stop_activities();

-- --------------------------------------------------------- collaboration --
CREATE TABLE trip_collaborators (
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       collaborator_role NOT NULL DEFAULT 'viewer',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX trip_collaborators_user_idx ON trip_collaborators (user_id);

CREATE TABLE trip_shares (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  slug       text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  -- 22 chars of base62 ~= 130 bits. Not guessable, not sequential.
  CONSTRAINT trip_shares_slug_shape CHECK (slug ~ '^[A-Za-z0-9_-]{16,64}$')
);
CREATE INDEX trip_shares_trip_idx ON trip_shares (trip_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE trip_shares IS 'Revocable public links. Revoking sets revoked_at; the row stays for audit.';
