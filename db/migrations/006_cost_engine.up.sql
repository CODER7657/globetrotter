-- ============================================================================
-- 006_cost_engine — the whole Budget screen in one query
-- ============================================================================
-- The Budget & Cost Breakdown screen (#30) makes exactly ONE database call.
-- Category totals, per-day spend, over-budget flags, and transfer warnings all
-- come back in a single jsonb document. No N+1, no aggregation in JavaScript.
--
-- A NOTE ON THE APPROACH, because issue #3 asked for a recursive CTE and this
-- deliberately does not use one:
--
--   A recursive CTE is the right tool for walking a graph of unknown depth. An
--   itinerary is a LINEAR chain ordered by seq, and for that, window functions
--   (sum() OVER, lag() OVER) are both simpler and faster — one ordered pass
--   instead of an iterated working table. Using recursion here would be
--   choosing the more impressive-sounding tool over the correct one.
--
--   Recursion earns its place the moment stops branch into alternative routes.
--   That is on the roadmap, not in this window. See docs/adr/0002.
-- ============================================================================

-- --------------------------------------------------------- FX conversion --
-- Every currency in the seed has an INR pair, so INR is used as the pivot.
-- That makes any-to-any conversion possible without seeding 3,192 direct pairs.
CREATE FUNCTION app.fx_convert(
  p_amount numeric,
  p_from   char(3),
  p_to     char(3),
  p_as_of  date DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_as_of date := coalesce(p_as_of, CURRENT_DATE);
  v_from_inr numeric;
  v_to_inr   numeric;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  IF p_from = p_to  THEN RETURN p_amount; END IF;

  -- INR per unit of p_from, using the most recent snapshot at or before as_of.
  IF p_from = 'INR' THEN
    v_from_inr := 1;
  ELSE
    SELECT rate INTO v_from_inr FROM fx_rates
     WHERE base_code = p_from AND quote_code = 'INR' AND as_of <= v_as_of
     ORDER BY as_of DESC LIMIT 1;
  END IF;

  IF p_to = 'INR' THEN
    v_to_inr := 1;
  ELSE
    SELECT rate INTO v_to_inr FROM fx_rates
     WHERE base_code = p_to AND quote_code = 'INR' AND as_of <= v_as_of
     ORDER BY as_of DESC LIMIT 1;
  END IF;

  IF v_from_inr IS NULL OR v_to_inr IS NULL THEN
    -- Loud rather than silently wrong: a missing rate must not become a
    -- plausible-looking number on a budget screen.
    RAISE EXCEPTION 'no FX rate to convert % -> % as of %', p_from, p_to, v_as_of
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN round(p_amount * v_from_inr / v_to_inr, 2);
END
$$;

COMMENT ON FUNCTION app.fx_convert IS
  'Any-to-any conversion pivoted through INR. Raises rather than guessing when a rate is absent.';

-- ------------------------------------------------------ the cost engine ---
CREATE FUNCTION app.trip_cost_breakdown(p_trip uuid)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
WITH t AS (
  SELECT id, base_currency, budget_cap, period,
         (upper(period) - lower(period))::int AS total_days
    FROM trips WHERE id = p_trip
),
-- One ordered pass over the chain. lag() gives us the previous leg, which is
-- all the "impossible transfer" check needs.
chain AS (
  SELECT s.id, s.seq, s.city_id, s.period,
         c.name AS city_name, co.name AS country_name,
         lower(s.period) AS arrive_at,
         upper(s.period) AS depart_at,
         GREATEST(1, (upper(s.period)::date - lower(s.period)::date)) AS nights,
         app.fx_convert(s.arrival_cost, t.base_currency, t.base_currency) AS transport_cost,
         app.fx_convert(s.lodging_cost, t.base_currency, t.base_currency) AS stay_cost,
         lag(upper(s.period)) OVER w AS prev_depart_at,
         lag(c.name)          OVER w AS prev_city_name
    FROM trip_stops s
    JOIN cities    c  ON c.id = s.city_id
    JOIN countries co ON co.code = c.country_code
   CROSS JOIN t
   WHERE s.trip_id = p_trip
  WINDOW w AS (ORDER BY s.seq)
),
-- Activities converted into the trip's base currency at their own rate.
acts AS (
  SELECT ta.stop_id,
         ta.category,
         ta.slot,
         lower(ta.slot)::date AS on_day,
         app.fx_convert(ta.cost_amount, coalesce(a.currency_code, t.base_currency),
                        t.base_currency) AS amount
    FROM trip_activities ta
    JOIN chain ch      ON ch.id = ta.stop_id
    LEFT JOIN activities a ON a.id = ta.activity_id
   CROSS JOIN t
),
-- Running total across the chain, for the "cumulative spend vs cap" line chart.
cumulative AS (
  SELECT ch.seq, ch.city_name,
         sum(ch.transport_cost + ch.stay_cost + coalesce(sa.spend, 0))
           OVER (ORDER BY ch.seq ROWS UNBOUNDED PRECEDING) AS running_total
    FROM chain ch
    LEFT JOIN (SELECT stop_id, sum(amount) AS spend FROM acts GROUP BY 1) sa
           ON sa.stop_id = ch.id
),
-- Every calendar day of the trip, so gaps render as zero rather than vanishing.
days AS (
  SELECT d::date AS day FROM t, generate_series(lower(t.period), upper(t.period) - 1, interval '1 day') d
),
day_spend AS (
  SELECT dd.day,
         coalesce((SELECT sum(amount) FROM acts WHERE on_day = dd.day), 0)
       + coalesce((SELECT sum(ch.transport_cost) FROM chain ch WHERE ch.arrive_at::date = dd.day), 0)
       -- Lodging is amortised across the nights it covers rather than dumped
       -- on the arrival day, otherwise the per-day chart is meaningless.
       + coalesce((SELECT sum(ch.stay_cost / ch.nights) FROM chain ch
                    WHERE dd.day >= ch.arrive_at::date AND dd.day < ch.depart_at::date), 0)
         AS amount
    FROM days dd
),
categories AS (
  SELECT 'transport'::text AS category, coalesce(sum(transport_cost), 0) AS amount FROM chain
  UNION ALL
  SELECT 'stay',      coalesce(sum(stay_cost), 0) FROM chain
  UNION ALL
  SELECT ac.category::text, coalesce(sum(ac.amount), 0) FROM acts ac GROUP BY ac.category
),
category_totals AS (
  SELECT category, sum(amount) AS amount FROM categories GROUP BY category HAVING sum(amount) > 0
),
grand AS (SELECT coalesce(sum(amount), 0) AS total FROM category_totals),
-- Arriving somewhere before you left the last place. The temporal constraints
-- make overlap unstorable, but a same-instant transfer is legal and still wrong.
transfer_warnings AS (
  SELECT jsonb_build_object(
           'seq', seq,
           'from', prev_city_name,
           'to', city_name,
           'gapMinutes', round(EXTRACT(EPOCH FROM (arrive_at - prev_depart_at)) / 60)
         ) AS w
    FROM chain
   WHERE prev_depart_at IS NOT NULL
     AND arrive_at - prev_depart_at < interval '90 minutes'
)
SELECT jsonb_build_object(
  'tripId',        p_trip,
  'currency',      (SELECT base_currency FROM t),
  'totalDays',     (SELECT total_days FROM t),
  'total',         (SELECT total FROM grand),
  'budgetCap',     (SELECT budget_cap FROM t),
  'remaining',     CASE WHEN (SELECT budget_cap FROM t) IS NULL THEN NULL
                        ELSE (SELECT budget_cap FROM t) - (SELECT total FROM grand) END,
  'overBudget',    CASE WHEN (SELECT budget_cap FROM t) IS NULL THEN false
                        ELSE (SELECT total FROM grand) > (SELECT budget_cap FROM t) END,
  'perDayAverage', CASE WHEN (SELECT total_days FROM t) > 0
                        THEN round((SELECT total FROM grand) / (SELECT total_days FROM t), 2)
                        ELSE 0 END,
  'byCategory',    coalesce((SELECT jsonb_object_agg(category, amount) FROM category_totals), '{}'::jsonb),
  'perDay',        coalesce((SELECT jsonb_agg(jsonb_build_object('day', day, 'amount', round(amount, 2)) ORDER BY day)
                               FROM day_spend), '[]'::jsonb),
  'cumulative',    coalesce((SELECT jsonb_agg(jsonb_build_object('seq', seq, 'city', city_name,
                                                                 'runningTotal', round(running_total, 2)) ORDER BY seq)
                               FROM cumulative), '[]'::jsonb),
  'stops',         coalesce((SELECT jsonb_agg(jsonb_build_object(
                                       'seq', seq, 'city', city_name, 'country', country_name,
                                       'nights', nights,
                                       'transport', round(transport_cost, 2),
                                       'stay', round(stay_cost, 2)) ORDER BY seq)
                               FROM chain), '[]'::jsonb),
  'warnings',      coalesce((SELECT jsonb_agg(w) FROM transfer_warnings), '[]'::jsonb)
)
$$;

COMMENT ON FUNCTION app.trip_cost_breakdown IS
  'Entire Budget screen in one call. Category totals, per-day spend, cumulative curve, transfer warnings.';

-- --------------------------------------------- dashboard summary (cheap) --
-- The dashboard lists many trips at once; calling the full breakdown per card
-- would be an N+1 in disguise. This view carries only the headline numbers.
CREATE MATERIALIZED VIEW trip_cost_summary_mv AS
SELECT t.id AS trip_id,
       t.owner_id,
       t.base_currency,
       t.budget_cap,
       (upper(t.period) - lower(t.period))::int AS total_days,
       count(DISTINCT s.id)                     AS stop_count,
       count(ta.id)                             AS activity_count,
       coalesce(sum(s.arrival_cost), 0)
         + coalesce(sum(s.lodging_cost), 0)
         + coalesce((SELECT sum(x.cost_amount)
                       FROM trip_activities x
                       JOIN trip_stops xs ON xs.id = x.stop_id
                      WHERE xs.trip_id = t.id), 0) AS total_cost
  FROM trips t
  LEFT JOIN trip_stops      s  ON s.trip_id = t.id
  LEFT JOIN trip_activities ta ON ta.stop_id = s.id
 WHERE t.deleted_at IS NULL
 GROUP BY t.id, t.owner_id, t.base_currency, t.budget_cap, t.period;

-- REFRESH CONCURRENTLY requires a unique index.
CREATE UNIQUE INDEX trip_cost_summary_mv_pk ON trip_cost_summary_mv (trip_id);
CREATE INDEX trip_cost_summary_mv_owner ON trip_cost_summary_mv (owner_id);

COMMENT ON MATERIALIZED VIEW trip_cost_summary_mv IS
  'Headline totals for trip cards. Refreshed out of band — never on the write path.';

GRANT SELECT ON trip_cost_summary_mv TO globetrotter_app;

-- Note: a materialized view does NOT enforce RLS. owner_id is projected so the
-- API can filter, and the read path must always constrain on it.
