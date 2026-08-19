# AGENTS.md

This file guides any coding agent — Claude Code, Codex, Cursor, or the next one —
working in this repository. `CLAUDE.md` is a one-line stub that imports this file
(`@AGENTS.md`), so Claude Code reads the same guidance; edit only this file.

## What this is

Quest Board — a self-hosted D&D campaign helper: a tavern quest board (DM authors quests + rewards, players join via invite code and self-claim), a 2024-rules character builder, custom skill trees, battle maps with server-side fog of war, a Monster Den + Bestiary, an encounter builder + initiative tracker, a shared Chronicle with DM handouts, and a homebrew codex. Go backend + React SPA, shipped as a single container behind a Cloudflare Tunnel. Live at dnd.fontao.net.

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

# Codegen — run after editing openapi/ or backend/queries/*.sql
make generate                   # bundle openapi/ + sqlc + oapi-codegen (Go) + openapi-typescript (TS)

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

## How we work

The repo is solo-maintained but run like a team project — labels, milestones,
and PR bodies are how the backlog is read months later. Follow the same
procedure regardless of which machine or tool you run on.

### Planning before building

- Features are sketched **with the user first**: discuss the design, agree on
  the shape, then build. Deploy locally (`make run` + the Vite dev server) so
  the user can review the result in a browser before anything is committed.
- Commit and open a PR **only when the user says ready** — never as a side
  effect of finishing the work.

### Issues

- Every issue gets **labels, an assignee, and a milestone**. Milestones are
  waves named `vX.Y — a name` (see the existing list); the number is ordering,
  the name is the theme.
- Label meanings beyond the GitHub defaults: `from-the-table` = feedback or
  asks from a real session; `ops` = deployment/backups/monitoring;
  `tech-debt` = no user-visible change; `Release` = the PR cuts a release.
  The `claude` label **hands the issue to the hosted Claude agent** — apply it
  only when that is the intent.
- Issue bodies say *what happens today / how it should work / what it depends
  on* — enough that someone (human or agent) can pick it up cold.

### Pull requests

- Work on feature branches; `main` only changes via reviewed PRs, and the
  branch ruleset requires the CI checks.
- **Label and assign every PR.** Bodies follow the shape: what this is / how it
  works / tested / known seams. Known-but-deferred behaviour is *listed* in the
  PR, not left to be rediscovered.
- **Verify the commit, not the worktree**: a `git stash` between `add` and
  `commit` can unstage tracked edits — build and test HEAD in a detached
  worktree before pushing.
- Rebased branches can silently duplicate a **migration number**; build, vet
  and tests never catch it — only server startup does. Check
  `backend/internal/db/migrations/` for collisions after every rebase.

### Verification

- Frontend changes are verified **visually** — drive the real app (Playwright
  against the containerized stack: screenshots, hit-tests), not just `tsc` and
  `vite build` passing.
- The host may not have Node — build in Docker (`node:22-alpine`, and the
  Playwright image matching `PLAYWRIGHT_VERSION` in the Makefile for browser
  checks).

### Design gotchas

- Custom CSS lives in `@layer components`.
- **Buttons match their surface**: parchment surfaces take ghost-ink/red
  variants; hall (dark) surfaces take ghost-gold/ember. Audited app-wide in
  #186 — new buttons follow it.

### Content gotchas

- Monster `ac`/`hp` must be **integers** — a string there silently blanks the
  whole Den stat block and yields AC 0 in encounters.
- Pack text is **not markdown**: the reader renders paragraphs, bold, italic
  and tables only — no lists. `- ` bullets and a half-open `_` ship as literal
  characters.
- Shipped content packs are hand-polished — never regenerate one wholesale;
  splice one kind at a time. (They originate from a hand-saved 5etools archive
  processed by tooling outside this repo.)

## Architecture

Contract-first, code-generated at both ends. The API spec is the single source of truth, and it is **authored under `openapi/`** — an index plus per-domain `paths/` and `components/` files. `make generate` bundles that tree into `openapi.yaml` at the repo root, and both generators read the bundled file:

- `frontend/scripts/bundle-spec.mjs` (`make gen-spec`) bundles `openapi/` → `openapi.yaml`
- `oapi-codegen` (config: `backend/oapi-codegen.yaml`, strict-server + chi) generates `backend/internal/api/api.gen.go`
- `openapi-typescript` generates `frontend/src/api/schema.d.ts`, consumed by the `openapi-fetch` client in `frontend/src/api/client.ts`

The bundling step exists because `oapi-codegen` cannot follow an external `$ref` — it reads one as "generated into another Go package" and emits `type Health = Health`. `openapi/README.md` has the details and the rules for editing in there.

Never hand-edit generated files (`openapi.yaml`, `api.gen.go`, `schema.d.ts`, `backend/internal/db/*.sql.go`, `models.go`) — edit `openapi/`, the SQL, and run `make generate`.

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

Two defaults are set once and inherited everywhere, so features do not re-solve
them per call site:

- **Every request has a deadline and a bounded retry** — `lib/http.ts` wraps `fetch` for both the typed client and the hand-rolled auth routes. One 20-second budget covers a whole call, retries included (120s for map images and pack import/export); GET/PUT/PATCH/DELETE are replayed inside it, POST only when it carries an `Idempotency-Key`. Retries belong here, not in `main.tsx`, because only this layer knows the method. Don't add a second retry loop on the QueryClient.
- **Every mutation failure is said out loud** — a MutationCache handler in `main.tsx` raises a notice for any mutation error; a call site with a better surface of its own opts *out* with `meta: { quiet: true }`.

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

1. Add the path item to `openapi/paths/<domain>.yaml` and its schemas to `openapi/components/<domain>.yaml`, then a `$ref` line for each in the `openapi/openapi.yaml` index
2. `make generate`
3. Implement the new method on `Server` in `backend/internal/http` (compile fails until you do)
4. Add a hook to the matching domain module in `frontend/src/hooks/` using the freshly typed client

## Conventions

- Operator procedures — clearing a locked-out user's 2FA, and anything else you run on the box — live in `docs/RUNBOOK.md`. They are commands (`server admin ...`), never endpoints: shell access is the strongest authentication available and cannot be reached from the internet.
- Deployment details (Cloudflare Tunnel, OAuth app setup, production `.env` checklist) live in `docs/DEPLOY.md` and the bottom of `.env.example`. Multiple stacks on one host are isolated via `COMPOSE_PROJECT_NAME`. The staging instance and its workflow live in `docs/STAGING.md`; releases in `docs/RELEASING.md`.
- Metrics: `internal/metrics` serves Prometheus metrics on a private second listener (`:9091`, `METRICS_ADDR`) the tunnel never routes. The Prometheus + Grafana stack that scrapes it is homelab-wide and lives in its own repo: <https://github.com/goncalo1021pt/homelab-observability>.
- Design direction and feature roadmap live in `docs/VISION.md`; the design reference packages it curates are the zips in `design/`.
- **A hero is a list of classes.** `character_classes` holds (class, subclass, level) per class and is the truth about levels; `characters.class_id` is a *different* fact — the class they started as, the only one granting full starting proficiencies (PHB 2024, p.44) — and `characters.level` stays the total, which is what proficiency bonus, XP and cantrip scaling key off. A class's own tables (subclass level, ASI levels, features) are read at the hero's level **in that class**, never the total. Hit dice follow the same shape as pools: `characters.hit_dice_spent` JSONB stores only what was spent, keyed by die size, and the maximum is recomputed from the class rows — a Cleric 5 / Paladin 5 has five d8 and five d10 tracked apart. `primaryAbility` alone cannot express a prerequisite, because Fighter means "Strength **or** Dexterity" where Paladin means "and", so a class declares `data.multiclass.prerequisite.any` when it is the Fighter's reading; absent, every listed ability is required.
- **Two spell pools, never added together.** The shared one is the Multiclass Spellcaster table read at the combined caster level — full classes in full, `half` **rounded up** (a 2024 change from 2014's round-down), `third` rounded down (`backend/internal/rules/spellslots.go`). A hero casting from exactly one class keeps that class's own table, which for a half-caster is slower than the shared one. Pact Magic is absent from that sum: `characters.pact_slots_used` is its own column so a spent pact slot never shows as a Wizard's, and only it comes back on a short rest. Each prepared spell belongs to a class (`character_spells.class_id`) because it is cast off *that* class's ability, and the per-class allowances are read at the hero's level in that class — the slots can be higher than anything they may prepare. Casting can also ride on a **subclass** (#220): an Eldritch Knight's Fighter stays a non-caster while the subclass declares `data.spellcaster: "third"` and reads another class's list through `data.spellListClass: "Wizard"` — resolution is class first, subclass second (`castingDataOf` in `backend/internal/http/spells.go`, mirrored by `casterSourceFor` in `frontend/src/lib/spellcasting.ts`), and a lone third-caster's own table is the full-caster's at one third **rounded up**, empty before level 3.
- **The invite code reaches the DM and nobody else.** `toAPICampaign` takes a `forDM bool` — not a default — so every call site declares who is reading, and a new one cannot leak the code by forgetting (#207). It used to ride along in every payload, which meant any player could read their table's code out of `GET /campaigns` and hand it on after being kicked or banned, however carefully the UI hid it. A player's `inviteCode` is *absent*, not blank.
- **Content packs are additive.** Import upserts by `(kind, name)` — it never merges into an existing entry. To give an existing class more options, ship the kinds that already point at a class by name: a `subclass` (`data.class`), a `feat`, a `spell` (`data.classes`). A pack entry reusing an SRD name still imports, but shadows it (both get listed, and the codex rules on them separately) and the import report says so in `warnings`.
- **Fog can hang on a place.** A reveal batch may name a location (#191), and then two gates stand in front of its ground: the knowledge pool, and that place's veil resolved through the viewer's own heroes — ancestors included, exactly as the quest board resolves it. That is what makes "she grew up in Lisboa" expressible without a second veil system: the DM stamps the city once, hands the *place* to one hero, and the same stamps serve the whole table later when the place goes party-visible. The place gate lives in `filterRevealCircles` (`backend/internal/http/fog.go`), read by both the JSON map and the composited image through `playerRevealCircles`, so the two can never disagree about what a viewer may see. A batch with no place is the old behaviour, untouched. Deleting a place **cascades** to its batches rather than nulling them: a batch that lost its place would fall back to the pool, which would hand a struck city's ground to everyone.
- **The Folk carry two veils.** An NPC (#215) is filed under a place like a shop and veiled like a quest: `visible_to_party` plus `npc_visibility` per-hero overrides, resolved through the viewer's own heroes with the place tree's ancestor walk having the final word — hiding Porto hides everyone who lives there (`npcVeil` in `backend/internal/http/npcs.go`, borrowing `veil.locationVisibleTo`). The stats are a *second* veil (`stats_visible_to_party` + `npc_stat_visibility`) that only opens where the first has: the party can know the captain long before anyone reads her numbers, and one ranger can read them while the rest cannot. What stands behind a person is `content_id` (a Den monster — SRD or the DM's own homebrew) **or** `character_id`, never both; the nil UUID detaches, and deleting the place/monster degrades the NPC (`SET NULL`) rather than deletes them. Redaction is on the way out, as everywhere: a hidden person is absent from a player's payload, and a known one carries `statBlock`/`characterId` only when the stats veil allows.
- **A sheet makes a person statted, never seated.** `characters.kind` (`hero` | `npc`) is the discriminator (#227), and `ListCharactersByCampaign` filters `kind = 'hero'` — which is why one line keeps the Folk's bodies out of the roster, the adventurer count, the Hall block, the chronicle, encounter seating and `seatedCharacterIDs` (the veil resolver) at once. A body is forged on the Folk page through `POST /npcs/{id}/body`: DM-owned, campaign-scoped, off `ListCharactersByOwner` and `CountSeatedByOwner`, and refused a seat. Because nothing else ever points at it, a body **dies with its person** — detaching it, putting a Den monster there instead, deleting the NPC or striking the campaign all destroy it (`strikeNpcBody`), or it would be a row reachable from nowhere. `table_born` therefore means one thing again: a stub for a guest with no account.
- **An ally is one of the Folk with a state.** `npcs.traveling` (#228) puts a person beside the party without ever putting them in it — they sit in the roster's own *Traveling with you* section, counted among nobody, because #227's `kind` already keeps them off every hero query. Traveling **opens the veil on their existence and beats the place tree**: a traveler is where the party is, not where they are filed, or a veiled home town would hide the man riding beside the cart (`npcVisibleTo` returns early). Their numbers are a separate question and stay behind the stats veil. `npcs.control` (`dm|player|table` + `control_user_id`) says who runs them, and control **carries the numbers** — `runsAlly` lifts the stats veil for the runner alone and opens `PUT /npcs/{id}/hp`, the one door on a person that is not the DM's; a member who does not hold them gets a 404, not a 403. Hit points land where they live: a forged body's on its sheet, a stat-block person's on `npcs.hp_current` (NULL = untouched, maximum read off the block every time). In a fight they are a fourth combatant `kind` — `ally`, seated by `npc_id` — party-side like a `pc`, named to players rather than shown as "Unknown", one fight at a time, and mirrored home on every HP change.
- **Second stat blocks.** A hero's forms, companions and summons are rows in `character_creatures`, each resolving to a played block from three layers: the linked `monster` entry's `data`, its `scale` expressions evaluated against that hero, then the player's `overrides` on top (`backend/internal/rules/creatures.go`). Which features grant what is *content*, not code — a class/subclass/feat/species/item declares `data.companions: [{name, role, level}]` (naming a `monster` by name, the way a subclass names its class) or `data.forms: {feature, type, tempHp, table:[{level, known, maxCR, fly}]}` for a shapeshifter's allowance. So an Artificer pack ships a `monster` called Steel Defender plus a `subclass` naming it back, and the sheet grows a companion for a class this repo has never heard of. `scale` values are expressions over `level`, `prof` and the six ability modifiers (`backend/internal/rules/scale.go`), checked at import so a typo is refused at the door. Only `hp_current` is stored — the maximum is read off the resolved block every time, or a companion whose pool is "five times your level" would freeze at the level it was created.
- **`GET /characters/{id}/creature-options` is the only player-side door into monster content.** The Den (`kind=monster`) stays DM-only in `heroes.go`; this endpoint answers with what the hero's own features grant and nothing else, and `creatureBlockFor` re-checks that grant on every add.
- **Species choices.** A species' `data.choices` declares the picks it asks for at creation (`{id, name, type, choose, from?, options?}`); `type` decides what a pick means — `skill` joins `characters.skills`, `feat` joins `characters.feats`, and `lineage`/`size`/`ability`/`tool` are recorded on `characters.species_choices` for display. Validation lives in `backend/internal/http/species.go`, mirrored for the UI by `frontend/src/lib/species.ts`.
- **Magic items.** A magic item is an item *with a rarity*, never a separate type (#101). The mechanics ride on two data fields (#189): `bonus` (+1..+3 — AC on armor/shields/worn items, attack + damage on weapons, applied by `backend/internal/http/armor.go` and its mirror `frontend/src/lib/derive.ts`, held together by `fixtures/rules/armor-class.json`) and `wear` (a gear item's place on the body — cloak, ring, … — giving it an equip slot beyond armor/mainhand/offhand; `wearSlots` in `inventory.go`, mirrored in `frontend/src/components/sheet/items.ts`). Attunement is inventory state: `character_items.attuned`, per row, independent of equipped, capped at three by the handler — and an item that demands attunement contributes its bonus only while attuned. Most of `srd/items.json` is **generated** by `scripts/gen-srd-items.py` from the 5etools archive (the mundane 55 stay hand-authored); regenerate rather than hand-edit magic entries, and `srd_items_test.go` holds every entry to the pack validator.
- **Resource pools.** Rages, Channel Divinity, Focus Points: content declares `data.pools: [{name, uses, level?, shortRest?, shortRestLevel?}]` on any kind (`backend/internal/rules/pools.go`) — `uses` is a `scale`-style expression (`"max(1, cha)"`) or a table of exactly 20 values, `shortRest` is `none|one|all` (a long rest refills everything; the 2024 books lean on `one`), and `shortRestLevel` delays that rule until a level (Font of Inspiration). Pools deliberately do **not** parse the `featuresTable` display strings. Only spent counts are stored (`characters.pools_used` JSONB, keyed by pool name) — the max is recomputed from content × level on every read, and `rest.go` hands uses back inside the one-row rest UPDATE. Malformed declarations are refused at import like a bad `scale` expression; resolution walks `grantSources` (creatures.go), so a feat or an item grants a pool as readily as a class. Taking a form whose `granted_by` names a pool spends a use of it (empty pool = refusal), which is how Wild Shape pays — by declaration, not code.
