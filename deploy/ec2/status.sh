#!/usr/bin/env bash
# Shows the services, their health, their memory and the disk. Changes nothing.
. "$(dirname "$0")/lib.sh"

need_docker
[[ -f "$ENV_FILE" ]] || die "no .env yet: run ./make-env.sh"

step "services"
dc ps -a
step "memory and CPU now"
ids=$(dc ps -q)
if [[ -n "$ids" ]]; then
  # shellcheck disable=SC2086
  docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' $ids
fi
step "disk"
docker system df
df -h "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /)" 2>/dev/null || true
step "site"
info "origin: $(envval WEB_ORIGIN)   gate: $(envval ACCESS_GATE)   tls: $(envval TLS_MODE)   demo code: $([[ -n "$(envval DEMO_OTP_CODE)" ]] && echo set || echo 'not set')"
