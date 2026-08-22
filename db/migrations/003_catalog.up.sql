-- ============================================================================
-- 003_catalog — cities, cost indices, activities, opening schedules
-- ============================================================================
-- This is the read-heavy half of the system. Search runs against generated
-- tsvector columns (always in sync, impossible to forget to refresh) plus trigram
-- indexes for typo tolerance. The embedding column ships unpopulated; the HNSW
-- index is deliberately deferred until there are vectors to index.
-- ============================================================================

CREATE TABLE cities (
  id            uuid    PRIMARY KEY DEFAULT uuidv7(),
  country_code  char(2) NOT NULL REFERENCES countries(code) ON DELETE RESTRICT,
  name          text    NOT NULL,
  slug          text    NOT NULL,
  admin_area    text,
  latitude      numeric(8,5)  NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude     numeric(8,5)  NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  timezone      text    NOT NULL,
  population    integer CHECK (population IS NULL OR population >= 0),
  popularity    smallint NOT NULL DEFAULT 50 CHECK (popularity BETWEEN 0 AND 100),
  summary       text,
  hero_image_url text,
  best_months   smallint[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cities_name_len   CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT cities_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT cities_best_months_valid CHECK (
    best_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
  ),
  CONSTRAINT cities_image_scheme CHECK (hero_image_url IS NULL OR hero_image_url ~ '^https?://')
);

CREATE UNIQUE INDEX cities_country_slug_uq ON cities (country_code, slug);
CREATE INDEX cities_country_idx    ON cities (country_code);
CREATE INDEX cities_popularity_idx ON cities (popularity DESC);

-- Generated, not trigger-maintained: it cannot drift from the row it describes.
ALTER TABLE cities ADD COLUMN search_doc tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', app.immutable_unaccent(coalesce(name, ''))),       'A') ||
    setweight(to_tsvector('simple', app.immutable_unaccent(coalesce(admin_area, ''))), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')),                           'C')
  ) STORED;

CREATE INDEX cities_search_idx     ON cities USING gin  (search_doc);
CREATE INDEX cities_name_trgm_idx  ON cities USING gin  (app.immutable_unaccent(name) gin_trgm_ops);

ALTER TABLE cities ADD COLUMN embedding vector(768);
COMMENT ON COLUMN cities.embedding IS
  'Reserved for local nomic-embed-text vectors (issue #6, descoped for the 8h window). '
  'No HNSW index until populated — an index over all-NULL is pure overhead.';

CREATE TRIGGER cities_touch BEFORE UPDATE ON cities
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ------------------------------------------------------------ cost index --
-- Split from cities because it is versioned and multi-currency, and because a
-- daily-cost estimate is a different fact with a different lifecycle.
CREATE TABLE city_cost_index (
  city_id        uuid     NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  currency_code  char(3)  NOT NULL REFERENCES currencies(code),
  daily_budget   numeric(12,2) NOT NULL CHECK (daily_budget  > 0),
  daily_midrange numeric(12,2) NOT NULL CHECK (daily_midrange > 0),
  daily_luxury   numeric(12,2) NOT NULL CHECK (daily_luxury   > 0),
  meal_avg       numeric(12,2) NOT NULL CHECK (meal_avg       > 0),
  transit_avg    numeric(12,2) NOT NULL CHECK (transit_avg   >= 0),
  as_of          date     NOT NULL,
  PRIMARY KEY (city_id, as_of),
  CONSTRAINT cci_tiers_ordered CHECK (daily_budget <= daily_midrange AND daily_midrange <= daily_luxury)
);
COMMENT ON TABLE city_cost_index IS 'Versioned by as_of so a trip costed last month can be reproduced exactly.';

-- ------------------------------------------------------------ activities --
CREATE TABLE activity_categories (
  id      smallint PRIMARY KEY,
  slug    text     NOT NULL UNIQUE,
  label   text     NOT NULL,
  icon    text     NOT NULL,
  CONSTRAINT activity_categories_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE activities (
  id             uuid     PRIMARY KEY DEFAULT uuidv7(),
  city_id        uuid     NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  category_id    smallint NOT NULL REFERENCES activity_categories(id) ON DELETE RESTRICT,
  name           text     NOT NULL,
  slug           text     NOT NULL,
  description    text,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 1440),
  cost_amount    numeric(12,2) NOT NULL CHECK (cost_amount >= 0),
  currency_code  char(3)  NOT NULL REFERENCES currencies(code),
  rating         numeric(2,1) CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  image_url      text,
  booking_required boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT activities_name_len    CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT activities_slug_shape  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT activities_image_scheme CHECK (image_url IS NULL OR image_url ~ '^https?://')
);

CREATE UNIQUE INDEX activities_city_slug_uq ON activities (city_id, slug);
CREATE INDEX activities_city_idx      ON activities (city_id);
CREATE INDEX activities_category_idx  ON activities (category_id);
CREATE INDEX activities_cost_idx      ON activities (cost_amount);

ALTER TABLE activities ADD COLUMN search_doc tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',  app.immutable_unaccent(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')),                  'C')
  ) STORED;

CREATE INDEX activities_search_idx    ON activities USING gin (search_doc);
CREATE INDEX activities_name_trgm_idx ON activities USING gin (app.immutable_unaccent(name) gin_trgm_ops);

ALTER TABLE activities ADD COLUMN embedding vector(768);

CREATE TRIGGER activities_touch BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ------------------------------------------------------------- schedules --
-- Weekly opening hours. This is what powers "the Louvre is closed on Tuesdays"
-- in the feasibility checks, and it is why closures are data rather than code.
CREATE TABLE activity_schedules (
  id           uuid     PRIMARY KEY DEFAULT uuidv7(),
  activity_id  uuid     NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, matches EXTRACT(DOW)
  opens_at     time     NOT NULL,
  closes_at    time     NOT NULL,
  season_start smallint CHECK (season_start IS NULL OR season_start BETWEEN 1 AND 12),
  season_end   smallint CHECK (season_end   IS NULL OR season_end   BETWEEN 1 AND 12),
  CONSTRAINT activity_schedules_window  CHECK (closes_at > opens_at),
  CONSTRAINT activity_schedules_season  CHECK ((season_start IS NULL) = (season_end IS NULL))
);
CREATE INDEX activity_schedules_activity_idx ON activity_schedules (activity_id, day_of_week);

COMMENT ON TABLE activity_schedules IS
  'Absence of a row for a weekday means closed that day. Seasonal rows narrow it further.';
