#!/usr/bin/env bash
# Destroys the database and starts again from an empty, freshly seeded one. Use it between
# rehearsals: a rehearsal enrols the Platform Ops authenticator and claims labs, and only a reset
# undoes that. It also clears the sign-in request counters (they live in the database).
#
#   ./reset-demo.sh                                   prints what would be destroyed, does nothing
#   ./reset-demo.sh --yes-destroy-the-database        does it
. "$(dirname "$0")/lib.sh"

need_docker
validate_env

volume="${PROJECT}_postgres-data"
echo "This will DESTROY:"
echo "  - the database volume '$volume': every user, organisation, claim, booking, session,"
echo "    audit row and enrolled authenticator, and the demo data itself (it is loaded again)"
echo "  - the mail inbox (Mailpit; it keeps messages in memory)"
echo "It does NOT touch: the proxy's certificates (kept, so the certificate authority's rate"
echo "limits are not used up), the images, backups/ and .env."
echo
if [[ "${1:-}" != "--yes-destroy-the-database" ]]; then
  echo "Nothing was done. To go ahead run:  ./reset-demo.sh --yes-destroy-the-database" >&2
  trap - EXIT
  exit 2
fi
take_lock

step "stopping the application and removing the database"
dc stop web api
dc rm -sfv postgres mailpit
if docker volume inspect "$volume" >/dev/null 2>&1; then
  docker volume rm "$volume" >/dev/null
  info "removed volume $volume"
fi

step "starting the database and the mail stand-in, migrating"
dc up -d postgres mailpit
wait_postgres
dc run --rm --no-deps migrate

step "loading the demo data"
dc run --rm --no-deps migrate node dist/seed/cli.js demo

step "starting the application"
dc up -d
wait_healthy 420
after_seed
echo "Reset done. The demo accounts are fresh: Platform Ops has no authenticator yet."
