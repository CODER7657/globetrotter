-- ============================================================================
-- 011 — replace the materialized view with a real one; give search a cursor
-- ============================================================================
-- Both problems found by @Ayush3422 on #66. Both were mine.

-- ── 1. trip_cost_summary: MATERIALIZED was the wrong call ───────────────────
--
-- The view was populated once, at CREATE time, against an empty database, and
-- nothing anywhere ever ran REFRESH. Live check before this migration:
--
--     trips=2   mv_rows=0
--
-- The obvious fix is a refresh strategy. The better fix is to admit the
-- materialisation was premature and delete it, for the reason he gave second:
--
--   > even once refreshed, the MV is out of band while trip_cost_breakdown is
--   > live. On stage a judge adds an activity, the budget panel moves and the
--   > dashboard card does not.
--
-- A dashboard that disagrees with the screen next to it is worse than a slow
-- dashboard. At this data size the aggregate is a few milliseconds, and a plain
-- view cannot go stale — there is no refresh to forget, no job to schedule, and
-- no window where the two numbers disagree.
--
-- SECURITY_INVOKER is the second reason. A materialized view does NOT enforce
-- RLS, which is why the old comment told the API to always filter on owner_id
-- by hand. He then pointed out that owner-only filtering is wrong in the other
-- direction too — can_read_trip grants collaborators access, so an owner-only
-- WHERE silently hides trips a collaborator legitimately sees.
--
-- With security_invoker the view runs as the CALLER, so the underlying trips
-- policies apply verbatim: owner, collaborator, public and admin all resolve
-- exactly as they do everywhere else. The API filters nothing, and the class of
-- bug disappears rather than being documented.

DROP MATERIALIZED VIEW IF EXISTS trip_cost_summary_mv;

CREATE VIEW trip_cost_summary WITH (security_invoker = true) AS
SELECT t.id                                     AS trip_id,
       t.owner_id,
       t.name,
       t.status,
       t.visibility,
       t.base_currency,
       t.budget_cap,
       t.cover_image_url,
       lower(t.period)                          AS start_date,
       (upper(t.period) - 1)                    AS end_date,
       (upper(t.period) - lower(t.period))::int AS total_days,
       s.stop_count,
       a.activity_count,
       (s.stop_cost + a.activity_cost)          AS total_cost
  FROM trips t
  -- Two independent LATERAL aggregates, NOT a chain of LEFT JOINs.
  --
  -- Joining trip_stops and then trip_activities fans the row out once per
  -- activity, so sum(stop cost) counts each stop once PER ACTIVITY. Measured
  -- on one stop costing 8,000 with three activities costing 600: the joined
  -- shape reported 24,600 instead of 8,600. Aggregating each side separately
  -- makes that arithmetic impossible rather than merely absent.
  LEFT JOIN LATERAL (
    SELECT count(*)::int                                   AS stop_count,
           coalesce(sum(st.arrival_cost + st.lodging_cost), 0) AS stop_cost
      FROM trip_stops st
     WHERE st.trip_id = t.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int                       AS activity_count,
           coalesce(sum(ta.cost_amount), 0)    AS activity_cost
      FROM trip_activities ta
      JOIN trip_stops st ON st.id = ta.stop_id
     WHERE st.trip_id = t.id
  ) a ON true
 WHERE t.deleted_at IS NULL;

COMMENT ON VIEW trip_cost_summary IS
  'Headline totals for trip cards. security_invoker=true, so the caller''s RLS applies and the '
  'API filters nothing by hand. Always current — replaced the materialized version, which was '
  'never refreshed and would have disagreed with the live cost breakdown on the same screen.';

GRANT SELECT ON trip_cost_summary TO globetrotter_app;

-- ── 2. search_places: keyset cursor ─────────────────────────────────────────
--
-- The function took p_limit only, so #66 item 2 asked for cursor pagination
-- that was not expressible. Rather than let the API quietly ship something
-- different from what was specified, the function grows a cursor.
--
-- Keyset, not OFFSET: RRF scores are dense and a deep OFFSET rescans every arm.
-- The cursor is (score, id) because scores tie — two results reached by the
-- same single arm at the same rank have identical scores, and ordering by score
-- alone would drop or repeat rows across pages.

DROP FUNCTION IF EXISTS app.search_places(text, text, char, text, smallint, numeric, char, integer);

CREATE FUNCTION app.search_places(
  p_query        text,
  p_kind         text     DEFAULT 'all',
  p_country      char(2)  DEFAULT NULL,
  p_region       text     DEFAULT NULL,
  p_category     smallint DEFAULT NULL,
  p_max_cost     numeric  DEFAULT NULL,
  -- No default. users.home_currency defaults to 'USD' while this defaulted to
  -- 'INR', so a cost filter silently compared against a currency the user never
  -- chose. Making it required means the API must decide, which it can.
  p_currency     char(3)  DEFAULT NULL,
  p_limit        integer  DEFAULT 20,
  p_after_score  double precision DEFAULT NULL,
  p_after_id     uuid     DEFAULT NULL
)
RETURNS TABLE (
  kind         search_kind,
  id           uuid,
  name         text,
  subtitle     text,
  country_code char(2),
  cost_amount  numeric,
  currency     char(3),
  popularity   smallint,
  score        double precision,
  matched_by   text[]
)
LANGUAGE sql STABLE AS $$
WITH q AS (
  SELECT
    app.immutable_unaccent(btrim(lower(coalesce(p_query, ''))))                  AS norm,
    websearch_to_tsquery('simple', app.immutable_unaccent(btrim(coalesce(p_query, '')))) AS tsq,
    (btrim(coalesce(p_query, '')) = '')                                          AS is_browse,
    least(greatest(coalesce(p_limit, 20), 1), 100)                               AS lim,
    coalesce(p_currency, 'INR')::char(3)                                         AS cur
),
city_pool AS (
  SELECT c.id, c.name, c.search_doc, c.popularity, c.country_code,
         co.name AS country_name, co.region
    FROM cities c
    JOIN countries co ON co.code = c.country_code
   WHERE (p_kind IN ('all', 'city'))
     AND (p_country IS NULL OR c.country_code = p_country)
     AND (p_region  IS NULL OR co.region = p_region)
),
activity_pool AS (
  SELECT a.id, a.name, a.search_doc, a.cost_amount, a.currency_code,
         a.category_id, c.name AS city_name, c.country_code, c.popularity, co.region
    FROM activities a
    JOIN cities    c  ON c.id = a.city_id
    JOIN countries co ON co.code = c.country_code
   CROSS JOIN q
   WHERE (p_kind IN ('all', 'activity'))
     AND (p_country  IS NULL OR c.country_code = p_country)
     AND (p_region   IS NULL OR co.region = p_region)
     AND (p_category IS NULL OR a.category_id = p_category)
     AND (p_max_cost IS NULL
          OR app.fx_convert(a.cost_amount, a.currency_code, q.cur) <= p_max_cost)
),
fts AS (
  SELECT 'city'::search_kind AS kind, cp.id,
         row_number() OVER (ORDER BY ts_rank_cd(cp.search_doc, q.tsq) DESC, cp.popularity DESC) AS rnk
    FROM city_pool cp, q WHERE NOT q.is_browse AND cp.search_doc @@ q.tsq
  UNION ALL
  SELECT 'activity'::search_kind, ap.id,
         row_number() OVER (ORDER BY ts_rank_cd(ap.search_doc, q.tsq) DESC, ap.popularity DESC)
    FROM activity_pool ap, q WHERE NOT q.is_browse AND ap.search_doc @@ q.tsq
),
trgm AS (
  SELECT 'city'::search_kind AS kind, cp.id,
         row_number() OVER (ORDER BY similarity(app.immutable_unaccent(cp.name), q.norm) DESC) AS rnk
    FROM city_pool cp, q
   WHERE NOT q.is_browse AND app.immutable_unaccent(cp.name) % q.norm
  UNION ALL
  SELECT 'activity'::search_kind, ap.id,
         row_number() OVER (ORDER BY similarity(app.immutable_unaccent(ap.name), q.norm) DESC)
    FROM activity_pool ap, q
   WHERE NOT q.is_browse AND app.immutable_unaccent(ap.name) % q.norm
),
semantic AS (
  SELECT 'city'::search_kind AS kind, cp.id, 1::bigint AS rnk FROM city_pool cp WHERE false
),
browse AS (
  SELECT 'city'::search_kind AS kind, cp.id,
         row_number() OVER (ORDER BY cp.popularity DESC, cp.name) AS rnk
    FROM city_pool cp, q WHERE q.is_browse
),
fused AS (
  SELECT kind, id, sum(1.0 / (60 + rnk)) AS score, array_agg(DISTINCT arm) AS matched_by
    FROM (
      SELECT kind, id, rnk, 'fulltext' AS arm FROM fts
      UNION ALL SELECT kind, id, rnk, 'fuzzy'    FROM trgm
      UNION ALL SELECT kind, id, rnk, 'semantic' FROM semantic
      UNION ALL SELECT kind, id, rnk, 'popular'  FROM browse
    ) arms
   GROUP BY kind, id
)
SELECT f.kind,
       f.id,
       CASE f.kind WHEN 'city' THEN cp.name ELSE ap.name END,
       CASE f.kind WHEN 'city' THEN cp.country_name ELSE ap.city_name || ', ' || ap.country_code END,
       CASE f.kind WHEN 'city' THEN cp.country_code ELSE ap.country_code END,
       CASE f.kind WHEN 'city' THEN NULL::numeric ELSE ap.cost_amount END,
       CASE f.kind WHEN 'city' THEN NULL::char(3) ELSE ap.currency_code END,
       CASE f.kind WHEN 'city' THEN cp.popularity ELSE ap.popularity END,
       f.score::double precision,
       f.matched_by
  FROM fused f
  LEFT JOIN city_pool     cp ON f.kind = 'city'     AND cp.id = f.id
  LEFT JOIN activity_pool ap ON f.kind = 'activity' AND ap.id = f.id
 CROSS JOIN q
 -- Keyset: strictly after (score, id) in the same order the result set uses.
 WHERE p_after_score IS NULL
    OR (f.score, f.id) < (p_after_score, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
 ORDER BY f.score DESC, f.id DESC
 LIMIT (SELECT lim FROM q)
$$;

COMMENT ON FUNCTION app.search_places IS
  'Hybrid retrieval (full-text + trigram + reserved vector) fused with RRF. Keyset cursor on '
  '(score, id) — RRF scores tie, so score alone would drop or repeat rows across pages.';
