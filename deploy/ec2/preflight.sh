#!/usr/bin/env bash
# Checks the server before the first `up`: Docker and the compose plugin, memory, disk, ports.
# Changes nothing. Ends with `preflight: OK` or fails.
#
# "Enough" (measured, DEMO.md "Sizing"):
#   memory  MemTotal at least MIN_MEM_MB and MemTotal plus swap at least MIN_MEM_SWAP_MB, from
#           /proc/meminfo. The stack at rest needs about 1 GB; the image build (pnpm install, tsc,
#           next build) peaks higher, which is why swap counts (setup-ec2.sh adds 4 GB).
#   disk    free space at least MIN_DISK_GB where Docker keeps its data (images, build cache, the
#           database volume, logs).
. "$(dirname "$0")/lib.sh"

MIN_MEM_MB="${MIN_MEM_MB:-3500}"
MIN_MEM_SWAP_MB="${MIN_MEM_SWAP_MB:-5500}"
MIN_DISK_GB="${MIN_DISK_GB:-20}"
failed=0
fail() { echo "FAIL: $*" >&2; failed=1; }

step "Docker"
command -v docker >/dev/null || fail "docker is not installed (run setup-ec2.sh)"
docker info >/dev/null 2>&1 || fail "cannot talk to Docker (service stopped, or your user is not in the docker group)"
if docker compose version >/dev/null 2>&1; then
  version=$(docker compose version --short 2>/dev/null | sed 's/^v//')
  major=${version%%.*}
  rest=${version#*.}
  minor=${rest%%.*}
  if [[ "${major:-0}" -lt 2 || ( "${major:-0}" -eq 2 && "${minor:-0}" -lt 20 ) ]]; then
    fail "docker compose $version is older than 2.20"
  else
    info "docker compose $version"
  fi
else
  fail "the Docker compose plugin is missing"
fi
docker buildx version >/dev/null 2>&1 || warn "the buildx plugin is missing; the Dockerfile's build needs BuildKit"

step "Memory"
if [[ -r /proc/meminfo ]]; then
  mem_mb=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)
  swap_mb=$(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo)
  info "MemTotal ${mem_mb} MB, swap ${swap_mb} MB"
  [[ $mem_mb -ge $MIN_MEM_MB ]] || fail "MemTotal ${mem_mb} MB is below ${MIN_MEM_MB} MB (use an instance with 4 GiB or more)"
  [[ $((mem_mb + swap_mb)) -ge $MIN_MEM_SWAP_MB ]] || fail "memory plus swap is below ${MIN_MEM_SWAP_MB} MB: run setup-ec2.sh (it adds swap) or use an 8 GiB instance"
else
  warn "no /proc/meminfo: memory not checked (not Linux)"
fi

step "Disk"
root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
[[ -d "$root" ]] || root=/
free_gb=$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}')
if [[ -n "$free_gb" ]]; then
  info "${free_gb} GB free under $root"
  [[ $free_gb -ge $MIN_DISK_GB ]] || fail "only ${free_gb} GB free under $root; ${MIN_DISK_GB} GB are needed (30 GB disk recommended)"
fi

step "Ports"
if [[ -f "$ENV_FILE" ]] && command -v ss >/dev/null; then
  for port in "$(envval HTTP_PORT)" "$(envval HTTPS_PORT)"; do
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${port}\$" && [[ -z "$(dc ps -q caddy 2>/dev/null || true)" ]]; then
      fail "port $port is already in use"
    fi
  done
  info "ports free or ours"
else
  info "skipped (no .env yet, or no ss)"
fi

step "Cloud metadata address from a container"
# Any successful answer means a container can talk to the instance metadata service.
if docker image inspect caddy:2.10.0-alpine >/dev/null 2>&1; then
  if docker run --rm caddy:2.10.0-alpine wget -q -T 3 -O /dev/null http://169.254.169.254/latest/meta-data/ 2>/dev/null; then
    warn "a container can read the metadata service. Set the instance to IMDSv2 only with a hop limit of 1 (DEMO.md)."
  else
    info "no successful answer from 169.254.169.254 (IMDSv2 with hop limit 1 refuses, as intended)"
  fi
else
  info "skipped (the proxy image is not pulled yet; run again after ./up.sh)"
fi

[[ $failed -eq 0 ]] || die "the server does not meet the requirements above."
echo "preflight: OK"
