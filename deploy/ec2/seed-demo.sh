#!/usr/bin/env bash
# Loads the fictitious demo data (labs, scope lines, bookings, the demo accounts). Safe to run
# twice: the seed does nothing when the data is already there. It applies the migrations first,
# so running it before `up` has finished (or on a fresh database) cannot hit a missing table.
. "$(dirname "$0")/lib.sh"

need_docker
validate_env
take_lock

step "making sure the database is up"
dc up -d postgres
wait_postgres

step "applying the migrations (idempotent)"
dc run --rm --no-deps migrate

step "loading the demo data (a few minutes on a small instance; one transaction)"
dc run --rm --no-deps migrate node dist/seed/cli.js demo
after_seed

echo
echo "Demo accounts, the claim story and the sign-in code: DEMO.md, \"The demonstration\"."
