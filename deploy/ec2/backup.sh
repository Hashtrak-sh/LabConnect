#!/usr/bin/env bash
# Dumps the database to backups/lc-<time>.dump (pg_dump custom format, owner only). Run it by hand;
# nothing runs it for you. The file holds the demo data and anything typed since: treat it like
# .env (do not copy it to a chat, a shared drive or an unencrypted backup).
. "$(dirname "$0")/lib.sh"

need_docker
validate_env
take_lock

umask 077
dir="$KIT/backups"
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/lc-$(date -u +%Y%m%dT%H%M%SZ).dump"

step "dumping $(envval POSTGRES_DB)"
if ! dc exec -T postgres pg_dump -U "$(envval POSTGRES_USER)" -d "$(envval POSTGRES_DB)" -Fc >"$file"; then
  rm -f "$file"
  die "pg_dump failed (is the database running? ./status.sh)."
fi
[[ -s "$file" ]] || { rm -f "$file"; die "the dump is empty."; }
chmod 600 "$file"
echo "wrote $file ($(wc -c <"$file") bytes). Check it with: ./restore-check.sh $file"
