#!/usr/bin/env bash
# ============================================================================
# migrate.sh — forward-only migration runner with a ledger.
#
#   ./migrate.sh up          apply every pending .up.sql, in order
#   ./migrate.sh down        revert the most recently applied migration
#   ./migrate.sh redo        down then up (the last one)
#   ./migrate.sh status      show applied vs pending
#   ./migrate.sh reset       drop everything and re-apply from zero
#
# Each migration runs inside a single transaction together with its ledger
# insert, so a migration either applies completely or not at all. There is no
# such thing as a half-applied migration here.
#
# Configuration comes from PG* env vars or DATABASE_URL.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$HERE/../migrations"
SEED_DIR="$HERE/../seed"

PSQL_BASE=(psql -v ON_ERROR_STOP=1 -q --no-psqlrc)
if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL=("${PSQL_BASE[@]}" "$DATABASE_URL")
else
  PSQL=("${PSQL_BASE[@]}")
fi

psql_run()  { "${PSQL[@]}" "$@"; }
psql_val()  { "${PSQL[@]}" -tAc "$1"; }

ensure_ledger() {
  psql_run -c "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text        PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer     NOT NULL
    );" >/dev/null
}

checksum_of() {
  # sha256sum on Linux, shasum on macOS. Both print "<hash>  <file>".
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

versions() {
  find "$MIGRATIONS_DIR" -name '*.up.sql' -print0 \
    | xargs -0 -n1 basename \
    | sed 's/\.up\.sql$//' \
    | sort
}

is_applied() {
  [[ "$(psql_val "SELECT count(*) FROM schema_migrations WHERE version = '$1'")" != "0" ]]
}

apply_one() {
  local version="$1"
  local file="$MIGRATIONS_DIR/$version.up.sql"
  local sum; sum="$(checksum_of "$file")"
  local start; start=$(date +%s%3N)

  # The migration body and its ledger row commit together, or neither does.
  {
    echo "BEGIN;"
    cat "$file"
    echo ";"
    echo "INSERT INTO schema_migrations (version, checksum, duration_ms) VALUES ('$version', '$sum', 0);"
    echo "COMMIT;"
  } | psql_run >/dev/null

  local ms=$(( $(date +%s%3N) - start ))
  psql_run -c "UPDATE schema_migrations SET duration_ms = $ms WHERE version = '$version';" >/dev/null
  printf '  \033[32m✓\033[0m %-32s %sms\n' "$version" "$ms"
}

revert_one() {
  local version="$1"
  local file="$MIGRATIONS_DIR/$version.down.sql"
  [[ -f "$file" ]] || { echo "  ✗ no down migration for $version" >&2; exit 1; }
  {
    echo "BEGIN;"
    cat "$file"
    echo ";"
    echo "DELETE FROM schema_migrations WHERE version = '$version';"
    echo "COMMIT;"
  } | psql_run >/dev/null
  printf '  \033[33m↓\033[0m %s\n' "$version"
}

cmd_up() {
  ensure_ledger
  local pending=0
  while read -r v; do
    [[ -z "$v" ]] && continue
    if is_applied "$v"; then continue; fi
    apply_one "$v"; pending=$((pending + 1))
  done < <(versions)
  if [[ $pending -eq 0 ]]; then echo "  already up to date"; fi
}

cmd_down() {
  ensure_ledger
  local last; last="$(psql_val "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")"
  [[ -n "$last" ]] || { echo "  nothing to revert"; return; }
  revert_one "$last"
}

cmd_status() {
  ensure_ledger
  echo "  version                          state      applied_at"
  while read -r v; do
    [[ -z "$v" ]] && continue
    if is_applied "$v"; then
      printf '  %-32s \033[32mapplied\033[0m    %s\n' "$v" "$(psql_val "SELECT to_char(applied_at,'HH24:MI:SS') FROM schema_migrations WHERE version='$v'")"
    else
      printf '  %-32s \033[33mpending\033[0m\n' "$v"
    fi
  done < <(versions)
}

cmd_reset() {
  echo "  dropping schemas…"
  psql_run -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public;" >/dev/null
  cmd_up
}

cmd_seed() {
  for f in "$SEED_DIR"/*.sql; do
    [[ -e "$f" ]] || continue
    printf '  \033[36m→\033[0m %s\n' "$(basename "$f")"
    psql_run -f "$f" >/dev/null
  done
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  redo)   cmd_down; cmd_up ;;
  status) cmd_status ;;
  reset)  cmd_reset ;;
  seed)   cmd_seed ;;
  *) echo "usage: $0 {up|down|redo|status|reset|seed}" >&2; exit 2 ;;
esac
