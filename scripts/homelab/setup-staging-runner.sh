#!/usr/bin/env bash
# Install a GitHub Actions self-hosted runner INSIDE the staging VM, labelled
# `staging`, and register it as a boot-persistent service. This is what lets the
# one-tap "Deploy to staging" workflow (.github/workflows/deploy-staging.yml)
# run `make deploy` on this box — so you can push a branch to dnd-test.fontao.net
# from the GitHub mobile app with no SSH.
#
# Get a REGISTRATION TOKEN first (it expires after ~1h, so grab it right before):
#   GitHub → repo → Settings → Actions → Runners → "New self-hosted runner"
#   → Linux/x64 → copy the token shown in the `./config.sh --token XXXX` line.
#
#   ssh <user>@<staging-vm>
#   ./setup-staging-runner.sh <REGISTRATION_TOKEN>
#
# Idempotent-ish: if a runner is already configured here, remove it first
# (cd ~/actions-runner && sudo ./svc.sh uninstall && ./config.sh remove --token <t>).
set -euo pipefail

TOKEN="${1:?usage: setup-staging-runner.sh <REGISTRATION_TOKEN>}"
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

echo "=== register (labels: self-hosted,staging) ==="
# --unattended + --replace so re-running just re-registers cleanly.
./config.sh --unattended --replace \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$(hostname)-staging" \
  --labels staging \
  --work _work

echo "=== install as a service (survives reboots) ==="
sudo ./svc.sh install "$USER"
sudo ./svc.sh start
sudo ./svc.sh status | head -20

echo ""
echo "Runner online. It appears under Settings → Actions → Runners as Idle."
echo "Trigger a deploy from GitHub → Actions → 'Deploy to staging' → Run workflow."
