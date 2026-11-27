#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 EC2 instance for the one-instance UAT (ADR-022): Docker Engine with
# the Compose plugin from Docker's own repository, git, and 4 GB of swap so the image build fits.
# Run once, as the default `ubuntu` user: `bash deploy/ec2/setup-ec2.sh`, then log out and in.
set -euo pipefail

sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl

# Docker's apt repository (https://docs.docker.com/engine/install/ubuntu/).
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"

# Swap: building the images (pnpm install and the Next.js build) needs more memory than runs.
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# Containers restart with the machine (`restart: unless-stopped` in the compose file).
sudo systemctl enable --now docker

echo "Done. Log out and back in (so the docker group applies), then follow deploy/ec2/README.md."
