# Deploying Quest Board (PowerEdge + Cloudflare Tunnel)

The whole app ships as a Docker Compose stack: **postgres + app + cloudflared**.
Cloudflare terminates TLS at its edge and the tunnel forwards plain HTTP to the
app over an outbound-only connection — **no ports are exposed on your router and
no public IP is needed.**

```
players ──▶ https://<your-domain> ──▶ Cloudflare edge ──▶ cloudflared (outbound)
                                                              │  (docker network)
                                                       app:8080 ──▶ postgres
```

## Prerequisites
- The server (PowerEdge) has Docker + Docker Compose and this repo checked out.
- Your domain is on Cloudflare (DNS managed by Cloudflare).

---

## 1. Create the Cloudflare Tunnel (dashboard, token-based)

1. Cloudflare **Zero Trust** dashboard → **Networks → Tunnels → Create a tunnel**.
2. Choose **Cloudflared**, name it (e.g. `questboard`), **Save**.
3. On the "Install connector" screen, copy the **token** (the long string after
   `--token`). You do **not** run the shown command — Compose runs cloudflared for
   you. Put the token in `.env` as `TUNNEL_TOKEN`.
4. Add a **Public Hostname**:
   - **Subdomain/domain**: pick the hostname players will use, e.g.
     `quests.<your-domain>`.
   - **Service**: **HTTP** → `app:8080`
     (`app` is the compose service name; cloudflared reaches it over the internal
     docker network).
5. Save. Cloudflare auto-creates the DNS record for that hostname.

> `BASE_URL` in `.env` must equal `https://<that hostname>`.

---

## 2. Create the OAuth apps

Dev login is disabled in production, so set up at least one. Redirect URLs use
your `BASE_URL`.

### Discord
1. https://discord.com/developers/applications → **New Application**.
2. **OAuth2** → **Redirects** → add:
   `https://<your-domain>/api/auth/discord/callback`
3. Copy **Client ID** and **Client Secret** → `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.

### Google
1. https://console.cloud.google.com/apis/credentials → **Create Credentials →
   OAuth client ID** → **Web application**.
2. **Authorized redirect URIs** → add:
   `https://<your-domain>/api/auth/google/callback`
3. Copy **Client ID** and **Client Secret** → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
   (You may need to configure the OAuth consent screen once.)

---

## 3. Configure `.env` on the server

```bash
cp .env.example .env
```
Set at least:
```ini
APP_ENV=production
BASE_URL=https://<your-domain>
SESSION_KEY=<openssl rand -base64 32>
POSTGRES_PASSWORD=<a strong password>
TUNNEL_TOKEN=<token from step 1>
# at least one provider:
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## 4. Deploy

```bash
docker compose --profile full up -d --build      # or: make deploy
```
This builds the SPA into the Go binary, starts Postgres, runs DB migrations
automatically on startup, and connects the tunnel. Then visit
`https://<your-domain>`.

---

## Operating it

```bash
docker compose --profile full ps                 # status
docker compose --profile full logs -f app        # app logs
docker compose --profile full logs -f cloudflared# tunnel logs
docker compose --profile full up -d --build      # redeploy after pulling changes
docker compose --profile full down               # stop (keeps the pgdata volume)
```

**Database backup** (the `pgdata` volume holds all data):
```bash
docker compose exec postgres pg_dump -U questboard questboard > backup-$(date +%F).sql
```

## Running a separate test environment (staging)

Run a **second, fully isolated stack** on the same server to test before prod.
Each stack is a separate Compose project, so its containers, network, and database
volume are independent — you can wipe/seed staging with zero risk to prod data.

```
prod  clone  ~/DnD_Helper          → https://dnd.fontao.net       (tracks main)
test  clone  ~/DnD_Helper-staging  → https://dnd-test.fontao.net  (any branch)
```

### One-time setup
1. **Clone again** into a second directory:
   ```bash
   git clone <repo> ~/DnD_Helper-staging
   ```
2. **Second Cloudflare tunnel**: in the dashboard create another tunnel for
   `dnd-test.fontao.net`, route its public hostname → `http://app:8080`, copy its
   token.
3. **OAuth**: add the staging redirect URLs to the *same* Discord/Google apps
   (they allow multiple redirect URIs):
   `https://dnd-test.fontao.net/api/auth/discord/callback` (and `/google/...`).
4. **`.env`** in `~/DnD_Helper-staging` — the keys that MUST differ from prod:
   ```ini
   COMPOSE_PROJECT_NAME=questboard-staging   # isolates containers + DB volume
   BASE_URL=https://dnd-test.fontao.net
   TUNNEL_TOKEN=<staging tunnel token>
   APP_HOST_PORT=8081                        # distinct host ports so the two
   POSTGRES_HOST_PORT=5433                   # stacks never collide
   SESSION_KEY=<its own openssl rand -base64 32>
   # APP_ENV can stay 'development' on staging for the dev-login shortcut, or
   # 'production' to mirror prod exactly.
   ```

### Deploy / promote workflow
```bash
# test a branch on staging
cd ~/DnD_Helper-staging && git fetch && git checkout <branch> && make deploy
#   → verify at https://dnd-test.fontao.net

# once merged to main, promote to prod
cd ~/DnD_Helper && git pull && make deploy
```
Prod only ever runs reviewed `main`; staging is where branches get tried first.
`make down` / `make logs` run from inside a clone only affect that environment.

## Troubleshooting
- **502 / tunnel can't reach app**: ensure the public hostname service is exactly
  `http://app:8080`, and `docker compose --profile full ps` shows `app` healthy.
- **OAuth redirect mismatch**: the provider's redirect URL must match
  `${BASE_URL}/api/auth/<provider>/callback` exactly (https, no trailing slash).
- **Login does nothing in prod**: confirm `APP_ENV=production` and that a provider's
  client id/secret are set; check `logs -f app`.
