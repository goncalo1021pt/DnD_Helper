# PowerEdge Setup — Handoff Brief

> **For the Claude instance helping set up the server.** You are working in parallel
> with another instance that is building the application code. **Your job is the
> infrastructure**: get the Dell PowerEdge into a state where it can run a Docker
> Compose stack and expose it to the internet via Cloudflare Tunnel. You do **not**
> need to touch application code — the app ships as a self-contained
> `docker compose` stack (details in the last section).

---

## 1. Mission

The user (Gonçalo) is building a self-hosted **D&D campaign helper** web app (a quest
board + character builder). It runs as **2 containers**: a Go binary (REST API + an
embedded React SPA, serving on `:8080`) and **Postgres 16**. The long-term home for
this app — and for the user's future **personal website / home lab** — is a **Dell
PowerEdge** server they own but have **not finished setting up** and have hit
"several issues" with.

### Target architecture
```
players ──▶ <yourdomain> ──▶ Cloudflare edge ──▶ cloudflared (outbound tunnel)
                                                         │
                                            ┌────────────┴────────────┐
                                            │  PowerEdge (Docker host) │
                                            │  app(:8080) + postgres   │
                                            └─────────────────────────-┘
```

Key decisions already made (don't re-litigate, but flag if you see a real problem):
- **Host:** the PowerEdge (this doc's whole point). Until it's ready, the user runs
  the app locally on their PC + a Cloudflare *quick tunnel* during sessions.
- **Exposure:** **Cloudflare Tunnel** (`cloudflared`), outbound — **no port-forwarding,
  no inbound ports open** on the home router. This is a hard preference for safety.
- **Domain:** to be acquired via **Cloudflare Registrar** (the user has a friend at
  Cloudflare and wants to learn their products). DNS will live on Cloudflare.
- **Scale:** a handful of users (one D&D table). Do not over-engineer for scale.

### Definition of done
1. PowerEdge boots reliably into a stable OS with remote management working (iDRAC).
2. Docker + Docker Compose installed and working.
3. A static/reserved LAN IP so things don't move.
4. `cloudflared` installed, authenticated, and routing a hostname → the app.
5. The app's `docker compose` stack comes up and is reachable at the domain over HTTPS.

---

## 2. FIRST: gather facts (the user has this context; you don't)

Before giving any specific steps, **ask the user these** — the right path depends on
the answers. Don't assume; PowerEdge generations differ a lot.

1. **Exact model + generation** — e.g. "PowerEdge R720 (12th gen)", "R640 (14th gen)",
   "T330 tower", etc. (Check the front bezel / service tag / `dmidecode` if an OS is up.)
2. **What's the current state?** No OS? OS installed but won't boot? Can't see a display?
   Can't reach iDRAC? Stuck in BIOS/RAID config?
3. **What are the "several issues"?** Get them concretely. The most common are listed
   in §5 — match symptoms to those.
4. **iDRAC**: Does it have iDRAC? Can they reach its web UI? Do they know its IP and
   credentials? (iDRAC version 7/8 = older HTML5/Java console; iDRAC 9 = modern HTML5.)
5. **Storage**: How many drives, what sizes, and is there a **PERC** RAID controller?
   Do they want RAID (mirror for safety) or pass-through (e.g. for ZFS)?
6. **Network**: Wired to the router? Can they set a DHCP reservation on the router?
7. **Monitor/keyboard available**, or fully headless (must use iDRAC virtual console)?
8. **Noise/location** — is it in a living space? (PowerEdge fans can be very loud;
   may need quieting — see §5.)
9. **Intended scope** — just this app, or a general home lab + personal website too?
   (Drives the OS choice in §3.)

---

## 3. Choose the OS

Two good paths. Recommend based on the user's intended scope (Q9 above):

### Option A — Proxmox VE  *(recommended if they want a home lab + personal site)*
Debian-based **hypervisor**. Run multiple VMs/LXC containers, snapshots, web UI.
- Pros: isolates workloads (D&D app, personal website, experiments), easy backups/
  snapshots, great learning platform, web management.
- Cons: one more layer; you then create a VM (or LXC) that runs Docker.
- Path: install Proxmox bare-metal → create a Debian 12 VM (or a privileged LXC) →
  install Docker in it → deploy the stack there.

### Option B — Bare-metal Debian 12 / Ubuntu Server 24.04 LTS *(recommended if the box is dedicated to just this)*
- Pros: simplest, least overhead, fewest moving parts.
- Cons: one workload per box; no snapshots/VM niceties.
- Path: install Debian/Ubuntu → install Docker → deploy the stack.

> Default suggestion: **Proxmox** given the user explicitly wants a personal website +
> to explore self-hosting. But confirm — if they just want the D&D app up fast,
> bare-metal Debian is less to go wrong.

---

## 4. Setup path (phased)

Adapt to the answers from §2. General order:

### Phase 1 — Out-of-band management (iDRAC)
- At POST, press **F2** → **iDRAC Settings** to view/set the iDRAC network (set a
  static IP or note the DHCP one). Dedicated iDRAC NIC is cleanest if wired.
- Log into the iDRAC web UI. Newer units have a **unique default password** on a pull-
  tab/sticker; older units historically default to **`root` / `calvin`** (change it!).
- iDRAC gives you **Virtual Console** (remote screen/keyboard) + **Virtual Media**
  (mount an ISO over the network) — this is how you install an OS **headless**.

### Phase 2 — Storage / RAID (PERC)
- Enter the RAID controller config: **Ctrl+R** at boot, or via **F2 → Device Settings**,
  or the iDRAC storage page.
- Typical choices:
  - **RAID 1** (mirror) across two disks for the OS = simple redundancy. Good default.
  - **Pass-through / Non-RAID / HBA mode** if using **ZFS** (e.g. Proxmox ZFS). Note:
    many PERC cards don't do true HBA without flashing/"HBA mode"; "Non-RAID" disks are
    the usual workaround.
- Create the virtual disk(s) before installing the OS.

### Phase 3 — Install the OS
- Download the ISO (Proxmox VE, or Debian 12 / Ubuntu Server 24.04 LTS).
- Mount it via **iDRAC Virtual Media** (or write to USB with Rufus/`dd`).
- Set boot order / use the one-time boot menu (**F11**) to boot the installer.
- Choose **UEFI** boot (modern). Install to the virtual disk from Phase 2.

### Phase 4 — Network
- Give the server a **static IP** (in-OS) or a **DHCP reservation** on the router so it
  never moves. Note the IP — the tunnel and SSH depend on it.
- Enable SSH for remote admin.

### Phase 5 — Docker
On Debian/Ubuntu (or the Proxmox VM):
```bash
# Docker Engine + Compose plugin (official convenience script is fine for a home box)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in afterwards
docker run --rm hello-world       # verify
```

### Phase 6 — Cloudflare Tunnel
Prereq: the user has added their domain to Cloudflare (Registrar or DNS).
```bash
# Install cloudflared (Debian/Ubuntu)
# (use the official Cloudflare apt repo or the .deb from their releases)
cloudflared tunnel login                      # opens browser, authorizes the zone
cloudflared tunnel create questboard          # creates tunnel + credentials json
cloudflared tunnel route dns questboard app.<yourdomain>
```
Config (`~/.cloudflared/config.yml` or `/etc/cloudflared/config.yml`):
```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json
ingress:
  - hostname: app.<yourdomain>
    service: http://localhost:8080
  - service: http_status:404
```
Run it as a service: `sudo cloudflared service install` (systemd), or as a container
in the same compose project. Outbound only — **no router ports opened**.

> Tip for the user *right now* (before the server is ready): a **quick tunnel** needs
> no domain/account — `cloudflared tunnel --url http://localhost:8080` prints a
> throwaway `https://<random>.trycloudflare.com` URL. Great for running the app off
> their PC during a session.

---

## 5. Common PowerEdge gotchas (match to the user's symptoms)

- **"Can't see anything on screen / no monitor"** → Use iDRAC Virtual Console. Many
  PowerEdge ship without onboard GPU output prioritized; iDRAC is the intended path.
- **Can't reach iDRAC** → It may be on the *dedicated* iDRAC NIC (separate port labeled
  with a wrench) vs shared LOM. Check the cable is in the right port; set its IP via
  F2 → iDRAC Settings.
- **iDRAC default password unknown** → newer gens: unique pw on the service tag/sticker;
  older: `root`/`calvin`. Can be reset in F2 → iDRAC Settings.
- **Stuck at RAID / "no boot device"** → No virtual disk created yet, or disks are in
  Non-RAID state with no VD. Create a VD (Ctrl+R) before installing.
- **Boots to the wrong device / installer won't start** → F11 one-time boot menu; check
  UEFI vs Legacy consistency between installer and target.
- **Extremely loud fans** → Common on Dell when non-Dell drives/NICs are detected. Can
  be tamed via iDRAC fan profiles, or `ipmitool` raw commands (generation-specific —
  research the exact model before sending raw IPMI). Don't disable cooling blindly.
- **PERC won't expose raw disks for ZFS** → Look for "HBA mode" in the controller, or
  set each disk to "Non-RAID". Some cards need an IT-mode flash (advanced; only if needed).
- **Old iDRAC console needs Java** → iDRAC 7/8 may need the HTML5 console option enabled,
  or the legacy Java viewer; iDRAC 9 is HTML5 by default. Update iDRAC firmware if stuck.

---

## 6. Deploying THIS app (once Docker + tunnel are up)

The application repo is a standard Docker Compose project. The other Claude instance
is building it; when it's ready the deploy on the server is roughly:

```bash
git clone <the repo>            # or copy it over
cd questboard
cp .env.example .env            # then fill in real values (see below)
# Generate a session secret:
#   openssl rand -base64 32   -> SESSION_KEY
# Fill OAuth creds (Discord/Google) if using login.
docker compose --profile full up -d --build
```

What the stack contains (for your awareness — you don't edit it):
- `postgres` service (postgres:16-alpine, persistent volume `pgdata`).
- `app` service: multi-stage build (Vite SPA build → embedded into the Go binary),
  serves API + SPA on `:8080`, runs DB migrations automatically on startup.
- The Cloudflare Tunnel ingress (from §6) points `app.<yourdomain>` → `http://localhost:8080`
  (or `http://app:8080` if you run `cloudflared` inside the same compose network).

Env vars the app needs (in `.env`): `SESSION_KEY`, `DATABASE_URL` (compose sets this
to the internal postgres for the `app` service), `BASE_URL` (= `https://app.<yourdomain>`),
and optionally `DISCORD_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` for OAuth login.
`BASE_URL` matters because OAuth callback URLs are built from it — it must match what's
registered in the Discord/Google developer consoles.

### Handoff boundary
- **You (server instance):** OS, iDRAC, RAID, networking, Docker, Cloudflare account/
  domain/tunnel, running `docker compose up`, persistence/backups of the `pgdata` volume.
- **App instance:** everything inside the repo (Go, React, migrations, the Dockerfile/
  compose definitions). If you think a compose/env/Dockerfile change is needed for the
  server, note it and the user can relay it — don't hand-edit app code.

---

## 7. Suggested first message back to the user
Ask the §2 questions (especially: exact model, current state, the specific issues,
iDRAC reachability, and whether they want Proxmox or bare-metal). Then propose a
concrete next step for *their* specific situation rather than a generic walkthrough.
