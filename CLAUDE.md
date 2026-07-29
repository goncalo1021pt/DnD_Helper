# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Quest Board — a self-hosted D&D campaign helper: a tavern quest board (DM authors quests + rewards, players join via invite code and self-claim), a 2024-rules character builder, custom skill trees, battle maps with server-side fog of war, a Monster Den + Bestiary, an encounter builder + initiative tracker, a shared Chronicle, and a homebrew codex. Go backend + React SPA, shipped as a single container behind a Cloudflare Tunnel. Live at dnd.fontao.net.

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

# Go unit tests (auth crypto/password, species/spells, visibility/veils, fog, encounter, packs)
cd backend && go test ./...

# End-to-end (Playwright, in Docker — no Node needed on the host)
make test && make e2e           # start the app, then drive it
make e2e ARGS=forge             # one spec
```

Beware: `make test` starts the containerized app for manual testing — it is not a test runner. `make e2e` is.

Testing layers, and how to add to them, live in `docs/TESTING.md`. Two things
that bite: run e2e against a server with **no `RESEND_API_KEY`** (otherwise every
run fires real Resend calls), and keep `PLAYWRIGHT_VERSION` in the Makefile
identical to the exact-pinned `@playwright/test` in `frontend/package.json`.

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

All server state goes through TanStack Query hooks in `hooks/`, one module per domain (`quests.ts`, `encounters.ts`, `maps.ts`, …) re-exported from `hooks/index.ts` — so `from "../hooks"` resolves to the barrel and either import style works. Queries live beside the mutations that invalidate their keys. `api/client.ts` exports the single typed client and type aliases derived from the OpenAPI schema — new endpoint types flow in automatically after `make generate`. A 401 from `/me` is an expected state (login gate), not an error.

### The character-sheet exporter (`frontend/src/lib/sheet/`)

The one feature that deliberately sits outside the contract-first pattern: it is
pure client work, with no endpoint and no server involvement. One **Print**
button on the hero sheet draws a hero onto the official 2024 sheet — bundled at
`frontend/src/assets/dnd-2024-character-sheet.pdf`, and declared in `NOTICE`
since it is Wizards' artwork rather than SRD content — and opens the print
dialog. `print.ts` is the entry point and the only thing outside it should call;
it reaches `render.ts` through `import()` and the sheet through `fetch()`, which
keeps pdf-lib and 1.5 MB of PDF off the page load. Never import `render.ts`
eagerly. The coordinates in `layout2024.ts` are *measured* off the real sheet
(603 × 774pt, two pages) by scanning for its ruled lines and proficiency
circles — re-measure that way rather than nudging if a printing moves things.
Adding a box means a position in `layout2024.ts` and a value in `values.ts`.
Details in `docs/PRINTING.md`.

### Adding an endpoint

1. Add the path/schema to `openapi.yaml`
2. `make generate`
3. Implement the new method on `Server` in `backend/internal/http` (compile fails until you do)
4. Add a hook to the matching domain module in `frontend/src/hooks/` using the freshly typed client

## Conventions

- Work on feature branches; `main` only changes via reviewed PRs.
- Deployment details (Cloudflare Tunnel, OAuth app setup, production `.env` checklist) live in `docs/DEPLOY.md` and the bottom of `.env.example`. Multiple stacks on one host are isolated via `COMPOSE_PROJECT_NAME`.
- Metrics: `internal/metrics` serves Prometheus metrics on a private second listener (`:9091`, `METRICS_ADDR`) the tunnel never routes. The Prometheus + Grafana stack that scrapes it is homelab-wide and lives in its own repo: <https://github.com/goncalo1021pt/homelab-observability>.
- Design direction and feature roadmap live in `docs/VISION.md`; the design reference packages it curates are the zips in `design/`.
- **Content packs are additive.** Import upserts by `(kind, name)` — it never merges into an existing entry. To give an existing class more options, ship the kinds that already point at a class by name: a `subclass` (`data.class`), a `feat`, a `spell` (`data.classes`). A pack entry reusing an SRD name still imports, but shadows it (both get listed, and the codex rules on them separately) and the import report says so in `warnings`.
- **Species choices.** A species' `data.choices` declares the picks it asks for at creation (`{id, name, type, choose, from?, options?}`); `type` decides what a pick means — `skill` joins `characters.skills`, `feat` joins `characters.feats`, and `lineage`/`size`/`ability`/`tool` are recorded on `characters.species_choices` for display. Validation lives in `backend/internal/http/species.go`, mirrored for the UI by `frontend/src/lib/species.ts`.
