#!/usr/bin/env bash
# Proves a backup can be restored: loads it into a scratch database next to the real one, counts
# what came back, and drops the scratch database. The real database is not touched.
# Usage: ./restore-check.sh backups/lc-<time>.dump
# (Restoring over the real database is a manual, destructive step: DEMO.md, "Restore".)
. "$(dirname "$0")/lib.sh"

need_docker
validate_env
[[ $# -eq 1 && -f "$1" ]] || die "usage: ./restore-check.sh <backup file>"
file="$1"
user="$(envval POSTGRES_USER)"
scratch="restore_check_$$"
psql_admin() { dc exec -T postgres psql -U "$user" -d postgres -v ON_ERROR_STOP=1 -At "$@"; }
psql_scratch() { dc exec -T postgres psql -U "$user" -d "$scratch" -At "$@"; }

step "creating scratch database $scratch"
psql_admin -c "CREATE DATABASE $scratch"
cleanup() { psql_admin -c "DROP DATABASE IF EXISTS $scratch" >/dev/null 2>&1 || true; }
trap 'cleanup; on_exit' EXIT

step "restoring into it"
# Ownership and grants are skipped: the scratch copy is only read.
dc exec -T postgres pg_restore -U "$user" -d "$scratch" --no-owner --no-privileges <"$file" ||
  warn "pg_restore reported errors (shown above); the counts below say whether the data came back."

step "counting"
tables=$(psql_scratch -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
info "tables in public: $tables"
for t in app_user organisation lab_site booking; do
  info "rows in $t: $(psql_scratch -c "SELECT count(*) FROM $t" 2>/dev/null || echo n/a)"
done
[[ "${tables:-0}" -gt 10 ]] || die "the restored database has too few tables."
echo "restore check: OK (scratch database dropped)"
