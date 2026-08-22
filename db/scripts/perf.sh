#!/usr/bin/env bash
# Reproduces the numbers in docs/PERF.md. Requires a migrated + seeded database.
set -euo pipefail
PSQL=(psql -v ON_ERROR_STOP=1 -tA --no-psqlrc)
[[ -n "${DATABASE_URL:-}" ]] && PSQL+=("$DATABASE_URL")
TRIP="${1:-}"
if [[ -z "$TRIP" ]]; then
  TRIP=$("${PSQL[@]}" -c "SELECT id FROM trips ORDER BY created_at LIMIT 1")
fi
[[ -n "$TRIP" ]] || { echo "no trip to measure; seed one first" >&2; exit 1; }
echo "trip: $TRIP"
for label in "cost breakdown|SELECT app.trip_cost_breakdown('$TRIP')" \
             "search exact|SELECT * FROM app.search_places('jaipur')" \
             "search typo|SELECT * FROM app.search_places('barcelnoa')"; do
  name="${label%%|*}"; q="${label##*|}"
  t=$("${PSQL[@]}" -c "EXPLAIN (ANALYZE, TIMING) $q" | grep 'Execution Time' | grep -oE '[0-9.]+')
  printf '  %-18s %s ms\n' "$name" "$t"
done
