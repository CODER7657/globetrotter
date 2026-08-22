-- ============================================================================
-- 007_search — hybrid retrieval, fused in SQL, zero third-party services
-- ============================================================================
-- Three retrieval strategies over one corpus, combined with Reciprocal Rank
-- Fusion. No Algolia, no Elasticsearch, no embedding API.
--
--   1. Full-text   — tsvector + GIN. Handles stemming and phrase relevance.
--   2. Trigram     — pg_trgm + GIN. Handles typos: "barcelnoa" -> Barcelona.
--   3. Semantic    — pgvector. Column and code path exist; vectors are NOT
--                    populated in this window (#6 descoped). The fusion below
--                    simply sees zero rows from that arm and reweights.
--
-- RRF rather than score normalisation: ts_rank_cd and similarity() are on
-- incomparable scales, so adding or averaging them is meaningless. RRF only
-- uses each arm's ORDER, which is comparable by construction.
--
--   score = Σ  1 / (k + rank_in_arm)      k = 60, the standard damping constant
--
-- k=60 means the gap between rank 1 and 2 matters far more than 40 vs 41,
-- which is the behaviour you want from a search box.
-- ============================================================================

CREATE TYPE search_kind AS ENUM ('city', 'activity');

CREATE FUNCTION app.search_places(
  p_query      text,
  p_kind       text     DEFAULT 'all',
  p_country    char(2)  DEFAULT NULL,
  p_region     text     DEFAULT NULL,
  p_category   smallint DEFAULT NULL,
  p_max_cost   numeric  DEFAULT NULL,
  p_currency   char(3)  DEFAULT 'INR',
  p_limit      integer  DEFAULT 20
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
    btrim(coalesce(p_query, ''))                       AS raw,
    app.immutable_unaccent(btrim(lower(coalesce(p_query, '')))) AS norm,
    -- websearch_to_tsquery accepts quoted phrases and -negation, and never
    -- raises on malformed input the way to_tsquery does. User input goes
    -- straight in without a sanitising regex.
    websearch_to_tsquery('simple', app.immutable_unaccent(btrim(coalesce(p_query, '')))) AS tsq,
    (btrim(coalesce(p_query, '')) = '')                AS is_browse,
    least(greatest(coalesce(p_limit, 20), 1), 100)     AS lim
),

-- ── candidate pools, filtered before ranking ───────────────────────────────
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
         a.category_id, c.name AS city_name, c.country_code, c.popularity,
         co.region
    FROM activities a
    JOIN cities    c  ON c.id = a.city_id
    JOIN countries co ON co.code = c.country_code
   WHERE (p_kind IN ('all', 'activity'))
     AND (p_country  IS NULL OR c.country_code = p_country)
     AND (p_region   IS NULL OR co.region = p_region)
     AND (p_category IS NULL OR a.category_id = p_category)
     AND (p_max_cost IS NULL
          OR app.fx_convert(a.cost_amount, a.currency_code, coalesce(p_currency, 'INR')) <= p_max_cost)
),

-- ── arm 1: full text ───────────────────────────────────────────────────────
fts AS (
  SELECT 'city'::search_kind AS kind, cp.id,
         row_number() OVER (ORDER BY ts_rank_cd(cp.search_doc, q.tsq) DESC, cp.popularity DESC) AS rnk
    FROM city_pool cp, q
   WHERE NOT q.is_browse AND cp.search_doc @@ q.tsq
  UNION ALL
  SELECT 'activity'::search_kind, ap.id,
         row_number() OVER (ORDER BY ts_rank_cd(ap.search_doc, q.tsq) DESC, ap.popularity DESC)
    FROM activity_pool ap, q
   WHERE NOT q.is_browse AND ap.search_doc @@ q.tsq
),

-- ── arm 2: trigram (typo tolerance) ────────────────────────────────────────
trgm AS (
  SELECT 'city'::search_kind AS kind, cp.id,
         row_number() OVER (ORDER BY similarity(app.immutable_unaccent(cp.name), q.norm) DESC) AS rnk
    FROM city_pool cp, q
   WHERE NOT q.is_browse
     AND app.immutable_unaccent(cp.name) % q.norm
  UNION ALL
  SELECT 'activity'::search_kind, ap.id,
         row_number() OVER (ORDER BY similarity(app.immutable_unaccent(ap.name), q.norm) DESC)
    FROM activity_pool ap, q
   WHERE NOT q.is_browse
     AND app.immutable_unaccent(ap.name) % q.norm
),

-- ── arm 3: semantic — inert until #6 populates the vectors ─────────────────
semantic AS (
  SELECT 'city'::search_kind AS kind, cp.id, 1::bigint AS rnk
    FROM city_pool cp
   WHERE false
),

-- ── browse mode: empty query returns the popular set, not nothing ──────────
browse AS (
  SELECT 'city'::search_kind AS kind, cp.id,
         row_number() OVER (ORDER BY cp.popularity DESC, cp.name) AS rnk
    FROM city_pool cp, q
   WHERE q.is_browse
),

-- ── Reciprocal Rank Fusion ─────────────────────────────────────────────────
fused AS (
  SELECT kind, id,
         sum(1.0 / (60 + rnk))            AS score,
         array_agg(DISTINCT arm)          AS matched_by
    FROM (
      SELECT kind, id, rnk, 'fulltext' AS arm FROM fts
      UNION ALL
      SELECT kind, id, rnk, 'fuzzy'         FROM trgm
      UNION ALL
      SELECT kind, id, rnk, 'semantic'      FROM semantic
      UNION ALL
      SELECT kind, id, rnk, 'popular'       FROM browse
    ) arms
   GROUP BY kind, id
)
SELECT f.kind,
       f.id,
       CASE f.kind WHEN 'city' THEN cp.name ELSE ap.name END,
       CASE f.kind WHEN 'city' THEN cp.country_name
                   ELSE ap.city_name || ', ' || ap.country_code END,
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
 ORDER BY f.score DESC,
          CASE f.kind WHEN 'city' THEN cp.popularity ELSE ap.popularity END DESC NULLS LAST
 LIMIT (SELECT lim FROM q)
$$;

COMMENT ON FUNCTION app.search_places IS
  'Hybrid retrieval: full-text + trigram + (reserved) vector, fused with RRF. One call, no external service.';

-- Trigram similarity threshold. The 0.3 default is too eager on short city
-- names and surfaces noise; 0.35 keeps "barcelnoa" -> Barcelona while dropping
-- unrelated three-letter overlaps.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.similarity_threshold = 0.35',
                 current_database());
END $$;
