#!/usr/bin/env bash
# Install a GitHub Actions self-hosted runner INSIDE a deploy VM and register it
# as a boot-persistent service. This is what lets the one-tap deploy workflows
# run `make deploy` on the box — so you can ship from the GitHub mobile app with
# no SSH and no VPN.
#
# Defaults to the STAGING runner (label `staging`, driving deploy-staging.yml →
# dnd-test.fontao.net). Set RUNNER_LABEL to put one on another box; the prod VM
# wants `production`, which is what deploy-prod.yml targets:
#
#   RUNNER_LABEL=production ./setup-staging-runner.sh <REGISTRATION_TOKEN>
#
# Get a REGISTRATION TOKEN first (it expires after ~1h, so grab it right before):
#   GitHub → repo → Settings → Actions → Runners → "New self-hosted runner"
#   → Linux/x64 → copy the token shown in the `./config.sh --token XXXX` line.
#
#   ssh <user>@<vm>
#   ./setup-staging-runner.sh <REGISTRATION_TOKEN>
#
# Idempotent-ish: if a runner is already configured here, remove it first
# (cd ~/actions-runner && sudo ./svc.sh uninstall && ./config.sh remove --token <t>).
set -euo pipefail

TOKEN="${1:?usage: [RUNNER_LABEL=staging|production] setup-staging-runner.sh <REGISTRATION_TOKEN>}"
RUNNER_LABEL="${RUNNER_LABEL:-staging}"
REPO_URL="https://github.com/goncalo1021pt/DnD_Helper"
RUNNER_VERSION="2.336.0"   # bump to the latest from github.com/actions/runner/releases
DIR="$HOME/actions-runner"

echo "=== download runner v$RUNNER_VERSION ==="
mkdir -p "$DIR" && cd "$DIR"
if [ ! -f ./config.sh ]; then
  curl -fsSL -o runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  tar xzf runner.tar.gz && rm runner.tar.gz
fi

echo "=== runner native deps ==="
# The runner is a .NET app and needs libicu, which the Debian genericcloud image
# doesn't ship. Without this, config.sh dies with "Libicu's dependencies is
# missing for Dotnet Core 6.0" before it ever contacts GitHub.
sudo ./bin/installdependencies.sh >/dev/null

echo "=== register (labels: self-hosted,$RUNNER_LABEL) ==="
# --unattended + --replace so re-running just re-registers cleanly.
./config.sh --unattended --replace \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$(hostname)-$RUNNER_LABEL" \
  --labels "$RUNNER_LABEL" \
  --work _work

echo "=== install as a service (survives reboots) ==="
sudo ./svc.sh install "$USER"
sudo ./svc.sh start
sudo ./svc.sh status | head -20

echo ""
echo "Runner online. It appears under Settings → Actions → Runners as Idle."
if [ "$RUNNER_LABEL" = "production" ]; then
  echo "Trigger a deploy from GitHub → Actions → 'Deploy to production' → Run workflow."
else
  echo "Trigger a deploy from GitHub → Actions → 'Deploy to staging' → Run workflow."
fi
