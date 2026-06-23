# Quest Board — D&D Campaign Helper

A self-hosted web app for running D&D campaigns: a **tavern quest board** (players
browse quests + rewards and claim them) and a **character builder** with two custom
skill-tree systems, using 2024 (5.5e) rules.

> Status: **Phase 1 in progress** — the tavern quest board is built (DM authors
> quests + rewards, players join via invite code and self-claim). Phase 0
> foundations (auth, DB, codegen, deployable container) are in place.

## Stack

- **Backend:** Go (chi) · sqlc + pgx · golang-migrate · goth (Discord/Google OAuth) ·
  scs sessions · Postgres 16
- **Frontend:** React 19 + Vite + TypeScript · Tailwind v4 · TanStack Query ·
  React Router — built and **embedded into the Go binary** (`embed.FS`)
- **Contract:** `openapi.yaml` is the single source of truth; the Go server interface
  (`oapi-codegen`) and the typed TS client (`openapi-typescript`) are both generated
  from it.
- **Deploy:** one ~32 MB container (API + SPA, same-origin) + Postgres, behind a
  Cloudflare Tunnel. See [`poweredge.md`](./poweredge.md) for the home-server setup.

## Architecture

```
React SPA  ──embedded──▶  Go binary (:8080)  ──▶  Postgres
                           ├─ /api/*  REST (OpenAPI)
                           └─ /*      serves the SPA
```

The same origin serves API + SPA, so session cookies need no CORS.

## Development

Prereqs: Go 1.23+, Node 22+, Docker.

```bash
cp .env.example .env          # then set SESSION_KEY (openssl rand -base64 32)
docker compose up -d postgres # start the database
make tools                    # one-time: install sqlc + oapi-codegen
make run                      # run the API+migrations (backend on :8080)
cd frontend && npm install && npm run dev   # SPA dev server on :5173 (proxies /api)
```

In development, visit the Vite dev server (`:5173`). A **dev login** shortcut is
available (no OAuth needed) — enter a name on the login screen.

## Build & run the production artifact

```bash
make build                    # SPA -> embed -> single Go binary at bin/server
# or the full container:
docker compose --profile full up -d --build
```

## Code generation

After editing `openapi.yaml` or `backend/queries/*.sql`:

```bash
make generate                 # sqlc + oapi-codegen (Go) + openapi-typescript (TS client)
```

## Contributing

Work happens on feature branches; `main` only changes via reviewed PRs.
