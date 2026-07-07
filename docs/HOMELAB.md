# Homelab deployment (Proxmox VM runbook)

How Quest Board runs on the home server. Written from the actual commands used
to build the current deployment (July 2026) so it can be reproduced from zero.
Cloudflare-Tunnel/production specifics live in [DEPLOY.md](./DEPLOY.md) — this
document covers the VM underneath and the LAN/VPN "showcase" mode.

## Topology

```
laptop (VPN) ──▶ Proxmox host  root@192.168.0.5  ("pve")
                   └─ VM 200 "apps"  goncalo@192.168.0.70  (Debian 13)
                        └─ docker compose: postgres + app  (+ cloudflared in prod)
```

- VM 200: 2 cores, 4 GB RAM, 32 GB disk, static IP `192.168.0.70/24`, gw `.1`.
- Base image: `debian-13-genericcloud-amd64.qcow2`, kept at
  `/var/lib/vz/template/iso/` on the PVE host.

## Creating the VM (on the PVE host)

```bash
qm create 200 --name apps --memory 4096 --cores 2 --cpu host \
  --net0 virtio,bridge=vmbr0 --scsihw virtio-scsi-single \
  --agent enabled=1 --serial0 socket --vga serial0 --ostype l26
qm set 200 --scsi0 local-lvm:0,import-from=/var/lib/vz/template/iso/debian-13-genericcloud-amd64.qcow2,discard=on,ssd=1
qm set 200 --boot order=scsi0
qm disk resize 200 scsi0 +29G                      # 3G image -> 32G
qm set 200 --ide2 local-lvm:cloudinit
qm set 200 --ipconfig0 ip=192.168.0.70/24,gw=192.168.0.1 --nameserver 1.1.1.1
qm set 200 --ciuser goncalo --sshkeys /tmp/keys.pub   # one pubkey per line
qm set 200 --ciupgrade 0                           # skip apt upgrade on first boot
qm start 200
```

SSH comes up in under a minute (`ssh goncalo@192.168.0.70`).

## Access

- **SSH (primary)**: `ssh goncalo@192.168.0.70` — key-only; the authorized
  keys are whatever `/tmp/keys.pub` contained at creation (currently the
  laptop and WSL keys). Root: `sudo -i` (passwordless sudo, no direct root
  login).
- **Proxmox UI console**: node `pve` → VM `200` → Console. The VM uses a
  serial console (`--vga serial0`), so this is an xterm.js terminal. Console
  login needs a *password*, which cloud-init did not set — create one once
  via SSH with `sudo passwd goncalo`, then console login works as a fallback
  when SSH/network is broken.
- **From the PVE host**: `ssh goncalo@192.168.0.70` works — the PVE root key
  (`/root/.ssh/id_ed25519.pub`) is authorized on the VM. Handy as a jump path
  from any device that can reach the PVE host: `ssh -J root@192.168.0.5
  goncalo@192.168.0.70`.
- **Adding another machine's key**: append its pubkey to
  `~/.ssh/authorized_keys` on the VM, or redo `qm set 200 --sshkeys` with the
  full key list (kept in `/tmp/keys.pub` on the PVE host) and reboot.

### Gotchas learned the hard way

- **Stale SSH host keys.** After destroying and recreating a VM on the same IP,
  `ssh` fails *silently* under `-o BatchMode -o StrictHostKeyChecking=accept-new`
  (accept-new accepts unknown hosts but refuses *changed* ones). Run
  `ssh-keygen -R 192.168.0.70` on every machine that connected to the old VM.
- **The image path**: Proxmox's ISO storage is `/var/lib/vz/template/iso/`,
  including for qcow2 cloud images uploaded through the UI.
- **`--sshkeys` takes a file** of public keys (newline-separated) and
  URL-encodes it into the config. Changing it regenerates the cloud-init ISO;
  the new instance-id makes cloud-init reapply users/keys on next boot.
- **The guest agent is not in genericcloud images** — `qm agent 200 ping`
  times out until `qemu-guest-agent` is installed inside the VM (the
  provisioning script does it). Until then, find the VM's IP by pinging the
  subnet and reading `ip neigh` for the VM's MAC on the PVE host.

## Provisioning the VM

One script, idempotent — installs the guest agent, Docker (+ compose plugin),
clones the repo, writes `.env` with generated secrets, and starts the
**showcase stack**:

```bash
scp scripts/homelab/provision-vm.sh goncalo@192.168.0.70:~
ssh goncalo@192.168.0.70 ./provision-vm.sh http://192.168.0.70:8080
```

Showcase mode = `APP_ENV=development` (the dev door is enabled — anyone who can
reach the app can log in as any name). **That is fine on the LAN/VPN and never
acceptable behind a public tunnel.** The production cutover is:
`.env` gets `APP_ENV=production`, `BASE_URL=https://<tunnel-host>`, OAuth
credentials and `TUNNEL_TOKEN` (see DEPLOY.md), then `make prod`.

The compose services carry `restart: unless-stopped`, so the stack survives VM
reboots on its own.

## Demo / showcase data

```bash
./scripts/demo/seed-showcase.sh http://192.168.0.70:8080
```

Seeds the full demo (needs dev login enabled): campaign
"Embers of the Sundered Crown" with six quests across every difficulty and
status, a three-character party with HP state, the next gathering scheduled for
the coming Saturday 19:00, and "The Mark of Vecna" — the 50-power, six-limb
skill-tree web (from `scripts/demo/vecna-nodes.tsv` + `vecna-edges.txt`) with
two characters bound and partway down their paths. Prints the invite code and
the two dev-door logins when done.

## Updating the app on the VM

```bash
ssh goncalo@192.168.0.70
cd ~/DnD_Helper && git pull
APP_ENV=development BASE_URL=http://192.168.0.70:8080 \
  sudo -E docker compose --profile full up -d --build postgres app
```

Migrations run automatically at app startup. The `pgdata` volume persists
across rebuilds; `sudo docker compose --profile full down` keeps it,
`down -v` destroys it.
