# Staging environment (test branches from anywhere, incl. your phone)

A second, fully isolated deployment for trying changes — hand-written branches
and **claude-bot PRs alike** — before they reach prod. It runs on its own
Proxmox VM with its own Cloudflare tunnel, so it's reachable at a real public
URL from a phone with no VPN/SSH, and it can never affect the live game or its
database.

```
                                   Proxmox host  root@192.168.0.5 ("pve")
laptop / phone ─┬─ https://dnd.fontao.net ──────▶ VM 200 "apps"          (prod,   tracks main)
                └─ https://dnd-test.fontao.net ─▶ VM 201 "apps-staging"  (staging, any branch)
```

Each VM is a separate machine: separate Docker, separate Postgres, separate
`pgdata`. Wipe, reseed, or break staging with zero risk to prod.

The magic that fixes "I can't test on mobile": staging has its **own Cloudflare
tunnel**, so `dnd-test.fontao.net` is a normal public HTTPS URL — open it on a
phone from anywhere. And a **one-tap GitHub Action** deploys any branch onto it,
so testing a bot PR is: tap → wait → open the URL.

---

## 1. Create the staging VM (on the PVE host)

Same recipe as [HOMELAB.md](./HOMELAB.md), new id/name/IP. VM **201**,
`192.168.0.71`:

```bash
qm create 201 --name apps-staging --memory 4096 --cores 2 --cpu host \
  --net0 virtio,bridge=vmbr0 --scsihw virtio-scsi-single \
  --agent enabled=1 --serial0 socket --vga serial0 --ostype l26
qm set 201 --scsi0 local-lvm:0,import-from=/var/lib/vz/template/iso/debian-13-genericcloud-amd64.qcow2,discard=on,ssd=1
qm set 201 --boot order=scsi0
qm disk resize 201 scsi0 +29G
qm set 201 --ide2 local-lvm:cloudinit
qm set 201 --ipconfig0 ip=192.168.0.71/24,gw=192.168.0.1 --nameserver 1.1.1.1
qm set 201 --ciuser goncalo --sshkeys /tmp/keys.pub
qm set 201 --ciupgrade 0
qm start 201
```

> Tight on host RAM? 2 GB is enough for staging (`--memory 2048`) — it isn't
> serving real players.

SSH up in under a minute: `ssh goncalo@192.168.0.71`.

## 2. Create the staging Cloudflare tunnel

In the Zero Trust dashboard, **exactly like prod but a second tunnel**
(see [DEPLOY.md §1](./DEPLOY.md)):

1. **Networks → Tunnels → Create a tunnel** → name `questboard-staging` → copy
   its **token**.
2. **Public Hostname** → `dnd-test.fontao.net` → Service **HTTP** → `app:8080`.

Tunnels are outbound-only, so this never collides with the prod tunnel even
though both boxes run an `app` on :8080.

## 3. Add the staging OAuth redirect URLs

Reuse the *same* Discord/Google apps as prod — they allow multiple redirect
URIs. Add:

```
https://dnd-test.fontao.net/api/auth/discord/callback
https://dnd-test.fontao.net/api/auth/google/callback
```

## 4. Provision the VM

```bash
scp scripts/homelab/provision-staging.sh goncalo@192.168.0.71:~
ssh goncalo@192.168.0.71 'TUNNEL_TOKEN=<staging-tunnel-token> ./provision-staging.sh'
```

This installs Docker + make, clones the repo, writes a staging `.env` (own
secrets, `COMPOSE_PROJECT_NAME=questboard-staging`, `BASE_URL=https://dnd-test.fontao.net`,
prod override pinned), and brings the tunnelled stack up. Verify at
**https://dnd-test.fontao.net**.

## 5. Register the deploy runner

This is what turns deploys into one tap. On GitHub: **Settings → Actions →
Runners → New self-hosted runner → Linux/x64**, copy the registration token,
then:

```bash
scp scripts/homelab/setup-staging-runner.sh goncalo@192.168.0.71:~
ssh goncalo@192.168.0.71 './setup-staging-runner.sh <REGISTRATION_TOKEN>'
```

It installs the runner as a boot-persistent service labelled `staging`. It'll
show as **Idle** under Runners when ready. (`.github/workflows/deploy-staging.yml`
must be on `main` for the workflow to appear — merge this first.)

---

## Daily use — deploy a branch to staging

**From a phone (no SSH):** GitHub app → repo → **Actions → "Deploy to staging"
→ Run workflow** → in *"Use workflow from"* pick the branch (a claude-bot
`claude/issue-NN-…` branch shows up here) → leave the ref box empty → **Run**.
Wait for the green check, open **https://dnd-test.fontao.net**.

**Testing a claude-bot PR** is now: bot opens the PR → you tap Deploy to staging
on that branch → try it on your phone → comment `@claude …` to iterate, or merge.

**From a terminal**, if you're already at one:
```bash
ssh goncalo@192.168.0.71 'cd ~/DnD_Helper && git fetch && git checkout <branch> && make deploy'
```

**Promote to prod** once merged — unchanged from today:
```bash
ssh goncalo@192.168.0.70 'cd ~/DnD_Helper && git pull && make deploy'
```

---

## Notes & safety

- **Auth on staging.** The provision script sets `APP_ENV=production`, so staging
  behaves exactly like prod (real login, dev door OFF) — the faithful test. If
  you'd rather have the frictionless **dev login** on staging (log in as any name,
  no OAuth), do NOT just flip `APP_ENV=development` — that door behind a public
  tunnel lets *anyone* in. Instead put `dnd-test.fontao.net` behind **Cloudflare
  Access** (Zero Trust → Access → Applications; allow only your email) so only
  you can reach the origin, *then* dev login is safe. Best of both: convenient
  and private.
- **Fresh data anytime.** Reseed the demo (needs dev login) with
  `./scripts/demo/seed-showcase.sh https://dnd-test.fontao.net`, or wipe the DB
  entirely with `docker compose --profile full down -v` in `~/DnD_Helper` on the
  staging box — prod is a different machine and is untouched.
- **The runner only runs this repo's jobs** and the deploy workflow is guarded to
  `github.actor == repository_owner`, so a bot PR can't self-deploy — only your
  dispatch does.
- **Resource use.** Staging is another full stack; if the PVE host gets tight,
  `qm stop 201` when you're not testing and `qm start 201` when you are (the
  runner + stack come back on their own via `restart: unless-stopped`).
