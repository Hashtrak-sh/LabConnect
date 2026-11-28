#!/usr/bin/env bash
# Brings the server to the latest commit of the branch it is on, with the old containers kept
# running while the new images are built:
#   1. git pull --ff-only          (SKIP_PULL=yes to skip, e.g. for a local change)
#   2. build the images            (the running containers are untouched; a failed build stops here)
#   3. apply the migrations        (the old code keeps running for these seconds)
#   4. recreate only what changed, then wait for health
#   5. delete dangling images and build cache older than three days
. "$(dirname "$0")/lib.sh"

need_docker
validate_env
take_lock

if [[ "${SKIP_PULL:-no}" == yes ]]; then
  step "git pull skipped (SKIP_PULL=yes)"
else
  step "pulling the branch you are on"
  git -C "$KIT" pull --ff-only
fi
git -C "$KIT" log -1 --format='    now at %h %s' 2>/dev/null || true

step "building the new images while the old containers keep running"
export COMPOSE_PARALLEL_LIMIT=1
dc build

step "applying the migrations"
dc run --rm --no-deps migrate

step "replacing the changed containers"
dc up -d
# The Caddyfile and snippets are bind mounts: a pull that changes only them recreates nothing, so
# load them now. A broken config fails here, with the operator watching, not at the next reboot.
step "reloading the proxy configuration"
dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile

wait_healthy 420

step "cleaning up old images and build cache"
docker image prune -f >/dev/null
docker builder prune -f --filter until=72h >/dev/null

dc ps
echo "Updated. Check it: node check/check.mjs $(envval WEB_ORIGIN)  (DEMO.md, \"Checking it works\")"
