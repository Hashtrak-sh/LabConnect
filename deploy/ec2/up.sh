#!/usr/bin/env bash
# Checks .env, builds the images one at a time (the build is the memory peak), migrates, starts
# everything and waits until it is healthy. Safe to run again: unchanged services are left alone
# and the migration job is idempotent. It does not load the demo data: see seed-demo.sh.
# (`docker compose up -d --build` still works; this adds the checks and the wait.)
. "$(dirname "$0")/lib.sh"

need_docker
validate_env
take_lock

step "building the images (migrate, api, web), one after the other"
export COMPOSE_PARALLEL_LIMIT=1
dc build

step "starting (the API waits for the migration job)"
dc up -d

wait_healthy 420
dc ps
echo
echo "Up: $(envval WEB_ORIGIN)   gate: $(envval ACCESS_GATE)"
echo "No demo data is loaded yet. Next: ./seed-demo.sh (safe to run twice)."
