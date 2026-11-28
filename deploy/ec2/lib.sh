#!/usr/bin/env bash
# Shared helpers of the scripts in deploy/ec2 (up.sh, update.sh, seed-demo.sh, reset-demo.sh,
# backup.sh, restore-check.sh, status.sh, preflight.sh). Sourced, never run.
#
# Assumed: Ubuntu 24.04 (what setup-ec2.sh installs), Docker Engine 24+, compose plugin 2.20+.
# Every script stops on the first error and says which step it was in.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(basename "$0")"
ENV_FILE="$KIT/.env"
# The compose project (`name:` in docker-compose.yml). COMPOSE_PROJECT_NAME overrides it.
PROJECT="${COMPOSE_PROJECT_NAME:-labconnect-uat}"

STEP="starting"
step() { STEP="$*"; echo "==> $*"; }
info() { echo "    $*"; }
warn() { echo "WARNING: $*" >&2; }
die() { echo "ERROR: $*" >&2; exit 1; }

# The exit code is passed in by a trap that runs other commands first (they would reset $?).
LOCK_DIR=""
on_exit() {
  local code=${1:-$?}
  [[ -n "$LOCK_DIR" ]] && rm -rf "$LOCK_DIR"
  if [[ $code -ne 0 ]]; then
    echo >&2
    echo "FAILED: $SCRIPT stopped at step \"$STEP\" (exit code $code). Nothing after it was run." >&2
  fi
}
trap on_exit EXIT

dc() { docker compose --project-directory "$KIT" "$@"; }

# One value of .env without sourcing it (values may be single-quoted and hold $ and \).
envval() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE does not exist. Run ./make-env.sh first."
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed "s/^'//; s/'\$//"
}

need_docker() {
  command -v docker >/dev/null || die "docker is not installed (run setup-ec2.sh)."
  docker info >/dev/null 2>&1 || die "Cannot talk to Docker: is the service running, and is your user in the docker group (log out and in after setup-ec2.sh)?"
  docker compose version >/dev/null 2>&1 || die "The Docker compose plugin is missing."
}

# Refuses to go on with settings that would be wrong or unsafe on a real server.
validate_env() {
  step "checking .env"
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE does not exist. Run ./make-env.sh first."
  if [[ "$(uname -s)" == Linux ]]; then
    local mode
    mode=$(stat -c %a "$ENV_FILE")
    [[ "$mode" =~ ^[0-7]00$ ]] || die ".env is readable by other users (mode $mode). Run: chmod 600 $ENV_FILE"
  fi
  local site origin tls gate https_port code want
  site=$(envval SITE_ADDRESS)
  origin=$(envval WEB_ORIGIN)
  tls=$(envval TLS_MODE)
  gate=$(envval ACCESS_GATE)
  # A .env made before HTTP_PORT and HTTPS_PORT existed has neither: compose uses 80 and 443.
  https_port=$(envval HTTPS_PORT)
  https_port=${https_port:-443}
  code=$(envval DEMO_OTP_CODE)
  [[ "$site" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "SITE_ADDRESS '$site' must be a plain domain name. Plain HTTP (':80') no longer exists: the server has a domain."
  case "$tls" in
    auto)
      [[ "$site" == *.* && "$site" != *.localhost && ! "$site" =~ ^[0-9.]+$ ]] || die "SITE_ADDRESS '$site' cannot get a public certificate (a real domain name is needed)."
      ;;
    internal)
      [[ "$site" == *.localhost ]] || die "TLS_MODE=internal (a certificate nobody trusts) is for local verification only and needs a *.localhost name. SITE_ADDRESS is '$site'."
      {
        echo
        echo "############################################################################"
        echo "# LOCAL VERIFICATION MODE: TLS_MODE=internal. Not a real deployment.       #"
        echo "############################################################################"
        echo
      } >&2
      ;;
    *) die "TLS_MODE must be auto or internal (it is '$tls')." ;;
  esac
  case "$gate" in
    on)
      [[ -n "$(envval GATE_USER)" ]] || die "ACCESS_GATE=on but GATE_USER is empty."
      [[ "$(envval GATE_PASSWORD_HASH)" == '$2'* ]] || die "ACCESS_GATE=on but GATE_PASSWORD_HASH is not a bcrypt hash."
      ;;
    off) warn "ACCESS_GATE=off: the site is open to everyone who can reach port 443." ;;
    *) die "ACCESS_GATE must be on or off (it is '$gate')." ;;
  esac
  if [[ "$https_port" == 443 ]]; then want="https://$site"; else want="https://$site:$https_port"; fi
  [[ "$origin" == "$want" ]] || die "WEB_ORIGIN is '$origin' but SITE_ADDRESS and HTTPS_PORT give '$want'. They must agree."
  [[ -z "$code" || "$code" =~ ^[0-9]{6}$ ]] || die "DEMO_OTP_CODE must be exactly six digits (or absent)."
  local key value
  for key in POSTGRES_PASSWORD API_DB_PASSWORD WORKER_DB_PASSWORD AUTH_JWT_PRIVATE_KEY AUTH_HASH_SECRET AUTH_ENCRYPTION_KEY PAYMENT_PAYLOAD_ENCRYPTION_KEY PAYMENT_FAKE_WEBHOOK_SECRET; do
    value=$(envval "$key")
    [[ -n "$value" ]] || die "$key is empty in .env."
  done
}

# Waits until every service with a health check is healthy.
wait_healthy() {
  local limit="${1:-420}" waited=0 bad svc id state
  step "waiting for the services to be healthy (up to ${limit} seconds)"
  while :; do
    bad=""
    for svc in postgres redis mailpit api web caddy; do
      id=$(dc ps -q "$svc" 2>/dev/null || true)
      if [[ -z "$id" ]]; then bad="$bad $svc(missing)"; continue; fi
      state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
      [[ "$state" == healthy || "$state" == running ]] || bad="$bad $svc($state)"
    done
    [[ -z "$bad" ]] && break
    [[ $waited -lt $limit ]] || die "not healthy after ${limit}s:$bad. See: docker compose logs <service>"
    sleep 5
    waited=$((waited + 5))
  done
  info "all services healthy"
}

wait_postgres() {
  local n=0
  until [[ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q postgres)" 2>/dev/null)" == healthy ]]; do
    n=$((n + 1))
    [[ $n -le 60 ]] || die "the database did not become healthy in 5 minutes."
    sleep 5
  done
  # The image's own start-up runs a temporary server (socket only) that already passes the
  # compose health check, then restarts: a job that connects in that gap fails with P1001.
  # So also wait until the real server answers on TCP, three times in a row.
  local ok=0
  n=0
  while [[ $ok -lt 3 ]]; do
    if dc exec -T postgres pg_isready -h 127.0.0.1 -q; then ok=$((ok + 1)); else ok=0; fi
    n=$((n + 1))
    [[ $n -le 60 ]] || die "the database does not answer on TCP."
    sleep 2
  done
}

# After a bulk load: refresh the planner's statistics now instead of leaving it to autovacuum
# (the first public search right after a seed failed once without them), then ask the API for one
# search so that its connection and caches are warm.
after_seed() {
  step "analysing the database and warming up the search"
  dc exec -T postgres psql -U "$(envval POSTGRES_USER)" -d "$(envval POSTGRES_DB)" -q -c 'ANALYZE' ||
    warn "ANALYZE failed; the first search may be slow or fail once"
  if [[ -n "$(dc ps -q api)" ]]; then
    local n=0
    while [[ $n -lt 3 ]]; do
      if dc exec -T web node -e "fetch('http://api:3001/v1/public/search/labs?q=TDS').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
        info "search answers"
        return 0
      fi
      n=$((n + 1))
      sleep 5
    done
    warn "the warm-up search did not answer (docker compose logs api)"
  fi
}

# Free space, in whole GB, where Docker keeps its images and build cache. Empty when unknown.
docker_free_gb() {
  local root
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
  [[ -d "$root" ]] || root=/
  df -Pk "$root" 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}' || true
}

# A build puts a second set of the application images next to the ones the running containers
# use, plus its build cache: a 28 GB disk with 4 GB free failed half-way ("no space left on
# device", 2026-11-28; after clearing the cache, the same server rebuilt from nothing with about
# 12 GB free). Below MIN_BUILD_GB free (default 10, chosen for the 28 GB UAT disk until it is
# grown), delete the build cache and the images no container uses (the running containers and the
# database volume are not touched; the build then starts from scratch and is slower), then check
# again and stop before building if it is still too little. With "fresh" as the first argument
# the clean-up always runs first (a build from scratch). A full disk also stops the running
# database from writing: a build from scratch is safer with 12 GB or more.
ensure_build_space() {
  local mode="${1:-}" want="${MIN_BUILD_GB:-10}" free
  [[ "$want" =~ ^[0-9]+$ ]] || die "MIN_BUILD_GB must be a whole number of GB (it is '$want')."
  step "checking the free disk space for the build"
  free=$(docker_free_gb)
  if [[ -z "$free" ]]; then
    warn "free disk space unknown: not checked"
    return 0
  fi
  info "${free} GB free for Docker (${want} GB wanted)"
  if [[ "$mode" == fresh ]]; then
    info "build from scratch (--fresh): deleting the build cache and the images no container uses"
  elif [[ $free -ge $want ]]; then
    return 0
  else
    info "too little: deleting the build cache and the images no container uses"
  fi
  docker builder prune -af >/dev/null
  docker image prune -af >/dev/null
  free=$(docker_free_gb)
  if [[ -z "$free" ]]; then
    warn "free disk space unknown after the clean-up: not checked"
    return 0
  fi
  info "${free} GB free after the clean-up"
  [[ $free -ge $want ]] || die "only ${free} GB free and a build needs about ${want} GB. The running site is unchanged. Grow the disk (DEMO.md, \"Disk\") or free space, then run this again."
}

# One script at a time.
take_lock() {
  # Outside the kit folder: the folder is part of the image build context (a file that changes on
  # every run would invalidate the build cache, and end up inside the migrate image).
  local lock="${TMPDIR:-/tmp}/labconnect-uat-kit-$(id -u).lock"
  if [[ -d "$lock" ]]; then
    local owner
    owner=$(cat "$lock/pid" 2>/dev/null || true)
    if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
      die "another script of this kit is running (process $owner)."
    fi
    warn "removing the lock of a script that died (process ${owner:-unknown})"
    rm -rf "$lock"
  fi
  mkdir "$lock" 2>/dev/null || die "another script of this kit is starting at the same moment."
  echo $$ >"$lock/pid"
  # on_exit (the EXIT trap) removes it, also when a script installs its own trap that calls on_exit.
  LOCK_DIR="$lock"
}
