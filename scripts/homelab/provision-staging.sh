#!/usr/bin/env bash
# Provision the "apps-staging" VM for Quest Board (Debian genericcloud image).
# Sibling of provision-vm.sh, but for the STAGING box: a second, fully isolated
# machine that mirrors prod and gets its OWN Cloudflare tunnel
# (dnd-test.fontao.net) so you can test branches — including claude-bot PRs —
# from a phone without touching the live game. See docs/STAGING.md for the
# `qm create` that builds VM 201 first, and for the runner + deploy flow after.
#
#   scp scripts/homelab/provision-staging.sh <user>@<staging-vm>:~
#   ssh <user>@<staging-vm> 'TUNNEL_TOKEN=<staging-token> ./provision-staging.sh'
#
# Env vars (all optional):
#   BASE_URL      public URL for staging   (default https://dnd-test.fontao.net)
#   TUNNEL_TOKEN  staging tunnel token from the CF dashboard. If set, the full
#                 tunnelled stack comes up now; if empty, only postgres+app start
#                 and you add the token to .env later, then run `make deploy`.
set -euo pipefail

BASE_URL="${BASE_URL:-https://dnd-test.fontao.net}"
TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"

echo "=== [1/5] base packages ==="
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  qemu-guest-agent git curl ca-certificates make >/dev/null
sudo systemctl enable --now qemu-guest-agent

echo "=== [2/5] docker (engine + compose plugin) ==="
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
sudo usermod -aG docker "$USER"   # so the GH Actions runner deploys without sudo
docker --version && sudo docker compose version

echo "=== [3/5] clone Quest Board ==="
if [ ! -d ~/DnD_Helper ]; then
  git clone -q https://github.com/goncalo1021pt/DnD_Helper.git ~/DnD_Helper
fi
cd ~/DnD_Helper && git pull -q

echo "=== [4/5] staging .env ==="
# Only the keys that must DIFFER from prod are set explicitly here; everything
# else inherits .env.example defaults. This mirrors prod (tunnel-only, no LAN
# exposure, APP_ENV=production) so staging is a faithful test — see docs/STAGING.md
# for the dev-login-behind-Cloudflare-Access alternative if you want it looser.
if [ ! -f .env ]; then
  cp .env.example .env
  {
    echo ""
    echo "# --- staging overrides (added by provision-staging.sh) ---"
    echo "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml"
    echo "COMPOSE_PROJECT_NAME=questboard-staging"
    echo "APP_ENV=production"
    echo "BASE_URL=$BASE_URL"
    echo "SESSION_KEY=$(openssl rand -base64 32)"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
    echo "TUNNEL_TOKEN=$TUNNEL_TOKEN"
  } >> .env
  echo "wrote .env (BASE_URL=$BASE_URL, project=questboard-staging)"
else
  echo ".env already exists — leaving it untouched"
fi

echo "=== [5/5] bring up the stack ==="
if [ -n "$TUNNEL_TOKEN" ]; then
  # COMPOSE_FILE in .env pins the prod override, so this is the full tunnelled
  # stack (postgres + app + cloudflared + backup).
  make deploy
  echo "staging is up behind the tunnel — verify at $BASE_URL"
else
  # No tunnel yet: run postgres + app only so you can smoke-test on the LAN,
  # then add TUNNEL_TOKEN to .env and run `make deploy` to attach the tunnel.
  APP_ENV=production BASE_URL="$BASE_URL" \
    docker compose up -d --build postgres app
  echo ""
  echo "postgres + app are up (no tunnel yet). Next:"
  echo "  1) create the staging tunnel (docs/STAGING.md), then in ~/DnD_Helper:"
  echo "     sed -i 's|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=<token>|' .env && make deploy"
fi
