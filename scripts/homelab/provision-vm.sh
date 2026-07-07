#!/usr/bin/env bash
# Provision the "apps" VM for Quest Board (Debian genericcloud image).
# Run as the cloud-init user (passwordless sudo). See docs/HOMELAB.md for the
# VM creation that precedes this, and for the production cutover afterwards.
#
#   scp scripts/homelab/provision-vm.sh <user>@<vm>:~ && ssh <user>@<vm> ./provision-vm.sh [BASE_URL]
#
# BASE_URL defaults to http://<vm-ip>:8080 style — pass the URL players will use.
set -euo pipefail

BASE_URL="${1:-http://192.168.0.70:8080}"

echo "=== [1/5] base packages ==="
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  qemu-guest-agent git curl ca-certificates >/dev/null
sudo systemctl enable --now qemu-guest-agent

echo "=== [2/5] docker (engine + compose plugin) ==="
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
sudo usermod -aG docker "$USER"
docker --version && sudo docker compose version

echo "=== [3/5] clone Quest Board ==="
if [ ! -d ~/DnD_Helper ]; then
  git clone -q https://github.com/goncalo1021pt/DnD_Helper.git ~/DnD_Helper
fi
cd ~/DnD_Helper && git pull -q

echo "=== [4/5] .env ==="
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^SESSION_KEY=.*|SESSION_KEY=$(openssl rand -base64 32)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
fi

echo "=== [5/5] showcase stack: postgres + app (no tunnel, dev login ON) ==="
# APP_ENV=development enables the dev door: fine on LAN/VPN, NEVER behind a
# public tunnel. Production flips APP_ENV and adds OAuth + TUNNEL_TOKEN
# (docs/DEPLOY.md), then runs `make prod` instead.
APP_ENV=development BASE_URL="$BASE_URL" \
  sudo -E docker compose --profile full up -d --build postgres app

echo "=== waiting for health ==="
for _ in $(seq 1 60); do
  if curl -sf http://localhost:8080/api/health >/dev/null 2>&1; then
    echo "HEALTHY — $BASE_URL"; exit 0
  fi
  sleep 5
done
echo "TIMED OUT waiting for health"; exit 1
