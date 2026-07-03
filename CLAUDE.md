# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Quest Board — a self-hosted D&D campaign helper: a tavern quest board (DM authors quests + rewards, players join via invite code and self-claim) with a character builder planned. Go backend + React SPA, shipped as a single container behind a Cloudflare Tunnel.

## Commands

```bash
# One-time setup
cp .env.example .env            # then set SESSION_KEY (openssl rand -base64 32)
make tools                      # install sqlc + oapi-codegen into GOPATH/bin
cd frontend && npm install

# Day-to-day development
docker compose up -d postgres   # database only
make run                        # Go server on :8080 (runs migrations on startup)
cd frontend && npm run dev      # Vite on :5173, proxies /api to :8080 — develop here

# Codegen — run after editing openapi.yaml or backend/queries/*.sql
make generate                   # sqlc + oapi-codegen (Go) + openapi-typescript (TS)

# Build / deploy
make build                      # SPA -> embed -> single Go binary at bin/server
make test                       # NOT unit tests: runs the whole app in containers at :8080
make prod                       # full production stack (app + postgres + cloudflared)
make logs S=app                 # follow a service's logs (app|postgres|cloudflared)

# Go tests (none exist yet; when added)
cd backend && go test ./...
```

Beware: `make test` starts the containerized app for manual testing — it is not a test runner.

## Architecture

Contract-first, code-generated at both ends. `openapi.yaml` (repo root) is the single source of truth:

- `oapi-codegen` (config: `backend/oapi-codegen.yaml`, strict-server + chi) generates `backend/internal/api/api.gen.go`
- `openapi-typescript` generates `frontend/src/api/schema.d.ts`, consumed by the `openapi-fetch` client in `frontend/src/api/client.ts`

Never hand-edit generated files (`api.gen.go`, `schema.d.ts`, `backend/internal/db/*.sql.go`, `models.go`) — edit the spec/SQL and run `make generate`.

### Request flow

```
React SPA ──embedded──▶ Go binary (:8080) ──▶ Postgres
                         ├─ /api/*  chi router: scs session middleware + auth.Loader
                         │   ├─ /api/auth/*  hand-rolled OAuth/dev-login routes (OUTSIDE the OpenAPI spec)
                         │   └─ generated strict handlers, implemented by Server in backend/internal/http
                         └─ /*      embedded SPA with client-side-routing fallback (internal/static)
```

Same origin serves API + SPA (Vite proxy in dev, `embed.FS` in prod), so session cookies need no CORS.

### Backend layers (`backend/`)

- `internal/http` — `Server` implements the generated `api.StrictServerInterface`. Handlers return typed response objects (e.g. `api.CreateCampaign201JSONResponse`) instead of writing to the ResponseWriter; return the 4xx object for expected failures, `nil, err` only for genuine 500s. Auth check pattern: `auth.UserID(ctx)` for identity, `s.requireDM(ctx, campaignID)` for DM-only ops. Multi-statement writes go through a pool transaction with `queries.WithTx` (see `createCampaignTx`).
- `internal/db` — sqlc output plus `migrate.go`/`pool.go`. Schema lives in `internal/db/migrations` as numbered golang-migrate up/down pairs; sqlc reads those migrations as its schema source and generates from handwritten queries in `backend/queries/*.sql`. Migrations run automatically at server startup — a schema change is: new migration pair + query changes + `make generate` + restart.
- `internal/auth` — goth (Discord/Google) + scs Postgres-backed sessions. Dev login (`internal/auth/dev.go`) creates/logs in a user by name with no OAuth — mounted only when `APP_ENV != production`. `/api/auth/config` is a public endpoint telling the SPA which login options the backend actually offers.
- `internal/static` — embeds `index.html` + `assets/`; `make embed` copies `frontend/dist` there before `go build`. A placeholder index.html keeps the embed valid during backend-only development.
- `internal/config` — env-based config; loads `.env` from repo root best-effort. `DATABASE_URL` and `SESSION_KEY` are required or startup fails.

### Frontend (`frontend/src/`)

All server state goes through TanStack Query hooks in `hooks.ts` (queries + mutations that invalidate related keys). `api/client.ts` exports the single typed client and type aliases derived from the OpenAPI schema — new endpoint types flow in automatically after `make generate`. A 401 from `/me` is an expected state (login gate), not an error.

### Adding an endpoint

1. Add the path/schema to `openapi.yaml`
2. `make generate`
3. Implement the new method on `Server` in `backend/internal/http` (compile fails until you do)
4. Add a hook in `frontend/src/hooks.ts` using the freshly typed client

## Conventions

- Work on feature branches; `main` only changes via reviewed PRs.
- Deployment details (Cloudflare Tunnel, OAuth app setup, production `.env` checklist) live in `docs/DEPLOY.md` and the bottom of `.env.example`. Multiple stacks on one host are isolated via `COMPOSE_PROJECT_NAME`.
- Design direction and feature roadmap live in `docs/VISION.md`; the design reference packages it curates are the zips in `design/`.
