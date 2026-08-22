DROP MATERIALIZED VIEW IF EXISTS trip_cost_summary_mv;
DROP FUNCTION IF EXISTS app.trip_cost_breakdown(uuid);
DROP FUNCTION IF EXISTS app.fx_convert(numeric, char, char, date);
