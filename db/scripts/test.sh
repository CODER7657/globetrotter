#!/usr/bin/env bash
# Runs the SQL test suite. Exits non-zero if any assertion fails, so CI blocks.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -q --no-psqlrc)
[[ -n "${DATABASE_URL:-}" ]] && PSQL+=("$DATABASE_URL")

"${PSQL[@]}" -f "$HERE/../tests/_harness.sql" >/dev/null
for f in "$HERE"/../tests/[0-9]*.sql; do
  echo "── $(basename "$f")"
  "${PSQL[@]}" -f "$f" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p'
done
