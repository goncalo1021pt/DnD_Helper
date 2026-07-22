# Quest Board — a self-hosted D&D campaign helper

A small, self-hosted web app for running **D&D 5.5e (2024)** campaigns: a tavern
**quest board**, a **character builder**, battle **maps with fog of war**, an
**encounter builder + initiative tracker**, a shared **campaign log**, and a
homebrew-friendly rules **codex** — all behind a single container and your own
login.

> **Status: v1.0.0 — first stable release.** Runs in production as a single
> container behind a Cloudflare Tunnel.

## Features

- **Tavern quest board** — the DM nails up quests with gold/XP/reputation rewards;
  players join a campaign by invite code and claim quests themselves.
- **Character builder** — forge heroes from classes, subclasses, species,
  backgrounds and feats; level them up; two custom skill-tree systems; a hero
  sheet page. Your imported content is a per-account library.
- **Maps & fog of war** — upload battle maps, nest sub-maps, drop pins, and reveal
  the world through **knowledge pools**. Fog is composited **server-side**, so
  players never receive the pixels they haven't uncovered.
- **Encounters** — a D&D-Beyond-style two-pane builder (filter the Monster Den,
  expand full stat cards inline, add with a tap) plus a live **initiative
  tracker** with HP, hidden enemies, and a redacted player view.
- **Monster Den & Bestiary** — the DM's private menagerie, and a player-facing
  creature journal revealed one hard-won section at a time.
- **Chronicle** — a campaign log and player chat with channel filters.
- **Rules reference** — quick 5e lookups (saves, conditions, proficiency, etc.).
- **Homebrew codex** — classes, subclasses, species, backgrounds, feats, spells,
  items and monsters are content-as-data; import/export as packs.
- **Accounts & security** — sign in with **Discord/Google** or a local
  **username + password**; email verification and password recovery (Resend);
  optional **two-factor auth (TOTP)** with recovery codes.

## Stack

- **Backend:** Go (chi) · sqlc + pgx · golang-migrate · goth (Discord/Google OAuth)
  + local password accounts · scs sessions · Postgres 16
- **Frontend:** React 19 + Vite + TypeScript · Tailwind v4 · TanStack Query ·
  React Router — built and **embedded into the Go binary** (`embed.FS`)
- **Contract:** `openapi.yaml` is the single source of truth; the Go server
  interface (`oapi-codegen`) and the typed TS client (`openapi-typescript`) are
  both generated from it.
- **Deploy:** one small container (API + SPA, same-origin) + Postgres, behind a
  Cloudflare Tunnel — no exposed ports, no public IP. See
  [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## Architecture

```
React SPA  ──embedded──▶  Go binary (:8080)  ──▶  Postgres
                           ├─ /api/*  REST (OpenAPI) + hand-rolled /api/auth/*
                           └─ /*      serves the SPA (client-side routing)
```

The same origin serves API + SPA, so session cookies need no CORS.

## Development

Prereqs: Go 1.25+, Node 22+, Docker.

```bash
cp .env.example .env          # then set SESSION_KEY (openssl rand -base64 32)
docker compose up -d postgres # start the database
make tools                    # one-time: install sqlc + oapi-codegen
make run                      # run the API + migrations (backend on :8080)
cd frontend && npm install && npm run dev   # SPA dev server on :5173 (proxies /api)
```

Develop against the Vite dev server (`:5173`). Outside production a **dev-login**
shortcut is available (no OAuth needed) — enter a name on the login screen; it is
never mounted when `APP_ENV=production`.

## Build & run the production artifact

```bash
make build                    # SPA -> embed -> single Go binary at bin/server
```

Full self-hosted stack (app + Postgres + Cloudflare tunnel), with the production
override that keeps Postgres and the app off the LAN:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full up -d --build
```

The complete production walkthrough — Cloudflare Tunnel, OAuth apps, the `.env`
checklist, and running more than one app on a host — is in
[`docs/DEPLOY.md`](./docs/DEPLOY.md).

## Code generation

After editing `openapi.yaml` or `backend/queries/*.sql`:

```bash
make generate                 # sqlc + oapi-codegen (Go) + openapi-typescript (TS client)
```

Never hand-edit generated files (`api.gen.go`, `schema.d.ts`, `*.sql.go`,
`models.go`) — edit the spec/SQL and regenerate.

## Content & licensing

The application code is licensed under the **MIT License** (see
[`LICENSE`](./LICENSE)). Baseline game content is the **SRD 5.2.1**, used under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) (© Wizards of the
Coast) — the required attribution lives in [`NOTICE`](./NOTICE). Any non-SRD
material is the operator's own homebrew, kept out of this repository.

Found a security issue? See [`SECURITY.md`](./SECURITY.md) — please report
privately, not via public issues.

## Contributing

Work happens on feature branches; `main` only changes via reviewed PRs.
