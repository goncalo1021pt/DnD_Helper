# Vision — Quest Board frontend & feature direction

Working notes for the frontend overhaul and the features that follow. The design
references live in `design/` as three Claude-generated handoff packages (zips,
each containing a README + `.dc.html` prototypes). They are **design decisions,
not specs** — visuals are curated from them; UX and dev calls are made here.

## The three design packages and what we take from each

| Package | Brand used | What it is | What we take |
|---|---|---|---|
| `D&D Application Main Page.zip` ("v0") | QuestBoard | Landing page, tavern aesthetic (wood/hearth bg, heraldic crest, angular iron+gold) | **Landing page direction**: the background/atmosphere and the crest/sigil emblem panel. Still needs iteration — treat as a starting point, not pixel-final. |
| `The Tavern_ D&D Companion.zip` | The Tavern | Landing + Quest Board; built from a purpose-written prompt *after* the backend existed, so it maps 1:1 onto the real data model | **The quest board page**: parchment notices, nailheads, difficulty wax seals, status tabs, reward tags, claim/release + DM actions. This is the authoritative reference for the board — "perfectly done", implement close to it. Also the OAuth-only login modal treatment. |
| `D&D Application Main Page V1.zip` ("Emberhall") | Emberhall | Landing + campaign dashboard; was a quick test, different aesthetic (dark-gold, rounded) | **Features, not visuals**: party roster w/ HP, chronicle (activity feed), next-session countdown, functional dice roller, quick actions. These become the **Party Menu**, re-skinned into the tavern material language. |

## Visual system (the shared base)

**Settled during Phase 2a (July 2026): the whole app uses the landing page's
"hall" language** — hearth-glow dark backgrounds, gold hairline panels/chips,
octagonal gold buttons on dark and wax-red on parchment, heraldic crest emblem.
The only Tavern-package survivor is the **parchment card** (quest notices with
wax seals, nailheads, status tabs, torn dividers; campaign cards; modals). The
Tavern's wood-beam/plank-board/iron-bracket structure and Pirata One sign were
built and then retired.

- **Materials**: hearth-dark grounds, gold hairlines, aged parchment for cards,
  ink-brown text on parchment, sparing wax-red + ember-gold accents.
- **Angular shape language**: 0–4px radii or clipped/beveled corners. No pills.
  Round only what is physically round (wax seals, nailheads, status dots).
- **Fonts** (Google Fonts): Cinzel Decorative (wordmark/quest titles), Cinzel
  (headings/labels/buttons), Spectral (body), IM Fell English (italic accents).
- All textures are pure CSS — no raster assets. Tokens + component classes live
  in `frontend/src/index.css` (custom classes MUST stay inside
  `@layer components` so Tailwind utilities can override them).
- **Emblem**: skeleton "bounty crest" (skull shield over crossed bones),
  `frontend/src/components/ui/Crest.tsx`. Alternate variants to choose from:
  `design/crest-concepts.html`.
- **Routing**: `/` is always the landing (signed in or not; CTA becomes "Enter
  the Tavern" → app). The app lives under `/questboard`; logged-out visits
  redirect to `/`.
- **The campaign hall (settled July 2026)**: opening a campaign lands on a
  dashboard hub à la the Emberhall reference — blocks showing the campaign at
  a glance (quest-board preview, party rows with ±HP, Next Gathering countdown
  tiles, Dice Tower), with the heavy tools as solo pages:
  `/questboard/campaigns/:id` (hub) → `…/board`, `…/party`. The floating dice
  button appears only on solo pages. New features (Chronicle, XP) arrive as
  hub blocks + solo pages where needed.
- **Dates (house rule)**: dd/mm order and a 24h clock everywhere, English day
  names — never locale-dependent. All formatting goes through
  `frontend/src/lib/dates.ts`.

Emberhall's dark-gold rounded style is **not** the direction; only its feature
set carries over.

## Roadmap

### Phase 2a — frontend overhaul (done, July 2026)
Design-system foundation, landing page (hearth + sigil emblem + OAuth/dev-login
modal driven by `/api/auth/config`), quest board with parchment notices against
the existing API, routing split, proper static cache headers.

### Phase 2b — Party Menu (Emberhall features, tavern skin)
New section with, roughly in order of value:
- ~~Party roster~~ — **done (July 2026)**: campaigns have Board/Party tabs;
  lightweight characters (name, freeform class line, level, HP) with
  owner-or-DM editing and quick ±HP. Deliberately minimal — it becomes the
  entry point to the character builder later.
- ~~Chronicle / activity feed~~ — **done (July 2026)**, then grew up (#33):
  from a DM-only event feed into a shared table log any member posts to, with
  channels (DM notes / rulings / player chat / happenings) and filters.
- ~~Next-session countdown~~ — **done (July 2026)**: `next_session_at` on
  campaigns; the DM schedules/clears from the hub's Next Gathering card
  (Emberhall-style Days/Hrs/Min tiles), everyone sees the ticking countdown.
- ~~Dice roller~~ — **done (July 2026)**: "Dice Tower" — a hub block, plus a
  floating corner button on solo pages. d4–d100 + coin, modifier, d20
  crit/fail call-outs, roll history. Client-side only; shared rolls could
  land in the Chronicle later.
- Quick actions — depends on what exists by then
- Hub polish (user note, July 2026): the quest-board block's integration on
  the hall needs another pass later.

Each backend-touching feature follows the established flow: migration + queries
→ `openapi.yaml` → `make generate` → handlers → hooks.

### Phase 3 — skill trees + character builder (planned July 2026)

**Priority ordering (campaign starts in weeks): skill-tree engine first, 2024
builder wizard second.** The app's first purpose is the user's own table.

**Skill trees** — two custom story-gated progression webs, separate from
standard D&D advancement (Vecna's tree first, Raven Queen's later; design doc
lives in the user's campaign notes). **Engine shipped July 2026** — routed at
`/questboard/campaigns/:id/trees` (the Loom tree/node/edge editor) with pacts,
DM-granted picks, reachability-gated spending, party-card integration, and a
functional SVG web view, demoed with a 50-node six-limb Vecna web. Still owed:
a full personal visual design pass (user note: "full personal design, think
about later"). Engine principles, all agreed:
- Content-as-data: trees → limbs → nodes (minor/keystone, flavor + trade-off
  text) → edges (a PoE-style web). The DM designs powers in a tree editor as
  the campaign design firms up; the engine never hardcodes content.
- Picks are granted by the DM at story beats (artifacts/dreams/favors), spent
  by the player on *reachable* nodes (entry nodes or adjacent to taken ones) —
  keystones gate deep in limbs via the web itself.
- **One tree per character** (exclusive pact, DM-assigned) — enforced in schema.
- Open design choices stay config, not code: keystone pick-cost (Option A = 2
  picks vs Option B = prereq-gated) is a per-tree dial; pick budget is pacing,
  not schema. **Corruption: undecided — deliberately not in the engine yet**
  (additive later).
- Visual web gets a dedicated design pass (Claude Design session) once the
  node list is locked; v1 renders a functional SVG web.

**Character builder (2024 rules)** — after the trees:
- **Account-level characters** (user decision): characters belong to the user
  and are seated into campaigns; current roster becomes "seated here".
- Legal architecture: the repo ships the rules **engine + SRD 5.2 seed data**
  (CC-BY-4.0, attribution file required); everything else (subclasses, feats,
  spells from owned books) enters through an in-app content editor into the
  instance's own DB — never committed. Private content packs exportable as
  gitignored JSON. Trademarks stay out of public branding.
- Creation wizard first (Class → Background → Species → Ability Scores),
  then the sheet view, then level-ups integrating the skill trees.

**Content trust model (decided July 2026, PR #15)** — three rules, chosen
with a public deployment (dnd.fontao.net) in mind:
- **Homebrew is private to its author.** The Scribe's Desk is a personal
  shelf; nothing you scribe is visible to anyone else by default. Names are
  unique per author, not per instance — two users may each own a "Gunslinger".
- **Each campaign has a codex** (`campaign_content`: proposed/enabled/banned)
  ruled solely by the DM: homebrew enters a world only when its author offers
  it and the DM admits it; SRD is legal by default but bannable per entry or
  in bulk (worlds with only custom classes are supported).
- **Strict seating**: a hero whose class/species/background/subclass is not
  codex-legal is held at the door (409 + one-tap proposal to the DM). The
  same legality gates level-up choices for seated heroes. Visibility rule
  everywhere: SRD + your own + enabled-in-your-campaigns.
- Instance access model — **decided 2026-07-24: dnd.fontao.net is a
  deliberately open server.** Anyone can sign up (Discord/Google or local
  account) and bring their own table; there is intentionally no invite-code or
  approval gate at the front door. The safety rests on the per-account/per-
  campaign isolation the content-trust model already enforces (your homebrew is
  private to you; a campaign's codex is ruled solely by its DM) plus the account
  hardening below (email verification, optional TOTP, failed-login rate
  limiting). If the server is ever abused, the gate would be added then — the
  schema supports it, the choice is policy, not missing code.

### v1 build-out — shipped (July 2026)

The builder, the skill-tree engine, and the campaign's full table toolset all
landed. Merged to `main`:

- **The Forge + hero sheets** (#22 onward): the 2024 creation wizard (Class →
  Background → Species → Abilities → Spells → Gear → Name), account-level heroes
  seated into campaigns, level-ups, spell-slot tracking, inventory + AC/attack
  math, and a solo hero-sheet page. The Dice Tower rides along wherever you roll
  (forge, sheet, and above modals for HP rolls on level-up). Every option step
  is sifted by search, source book, and the table whose codex the hero must
  satisfy (#92) — a homebrew-only campaign offers exactly its own classes.
- **Content pipeline**: content-as-data (class / species / background /
  subclass / feat / spell / item / monster), the Scribe's Desk editor, the
  per-campaign **codex** (propose / enable / ban) with **strict seating**,
  private **pack import/export** (a pack names its book, or takes the file's
  name, and every entry that doesn't already know its source is stamped with
  it), the SRD 5.2.1 seed, per-book source labels wherever content is listed,
  and collapse of the same official entry imported by several users.
- **Encounters** (#35, #69, #91): a prepared library the DM triggers at the
  table, plus filing — each fight carries a free-text session tag and a place
  from the location tree, and the library is searchable and shelved by either.
- **The Monster Den + Bestiary** (#23 onward): a DM-only monster library (SRD +
  homebrew, hunting-tool filters, pack import, source labels) and the party's
  **Bestiary** field-journal with DM-granted sectional reveals.
- **The Map + fog of war** (#28, #29, #31): postgres-stored campaign maps, a
  pan/zoom/pinch viewer, DM/party pins, sub-map travel, and knowledge-pool fog
  stamped on a draft then submitted — **composited server-side** so players
  never receive the hidden pixels.
- **The Profile** (#27): identity header, My Heroes moved in, the imported-pack
  library with per-book removal, embedded export + reset-my-homebrew.
- **Accounts + security** (#30, #32): local username/email + password accounts
  alongside Discord/Google (bcrypt, strength policy, IP rate-limiting,
  session-fixation fix); **email verification + password recovery via Resend**
  (hashed single-use tokens, anti-enumeration, tavern-themed emails).
- **The Chronicle** (#33): a shared table log (see Phase 2b).
- **Progression**: XP grants + milestone level-ups (DM), paired with the
  Chronicle. *(Later: lift these out of the Chronicle into their own menu — the
  Chronicle is now a chat surface, so the controls sit oddly there.)*

### Planned before v1 (added July 2026)

Two more DM tools slot in before v1 closes:

- **Encounter generator + initiative tracker** — a DM combat tool. Build
  encounters from Den monsters + the seated party **ahead of time** (prep a
  handful at home before a session — they sit as drafts in a per-campaign
  library) and **trigger any of them at will**; at most one runs at a time
  (draft → active → ended). Running it opens an initiative tracker.
  Initiative is **auto-rolled** (d20 + the monster's
  DEX-based init modifier — one combatant at a time, or a "roll all" button) or
  **typed** by the DM; the tracker shows turn order, the current turn, and the
  round, with HP tracked for the fight. **Open design — player integration**:
  players may not know an enemy exists yet (ambush), or may not know a
  creature's identity or stats. So enemy visibility in any shared view is
  DM-controlled and ties into the **Bestiary reveal model** (hidden → generic
  label → identified). Pending decisions: whether players see the tracker at
  all; how hidden/unidentified enemies appear; whether players ever see enemy HP
  (e.g. only a "bloodied" state); and whether players roll their own initiative
  or the DM rolls for everyone. **Decided: both** — a player can roll their own
  PC's initiative from their device, and the DM can also roll or type it for
  anyone who's absent or off-device. Player view = **shared read-only tracker,
  DM controls reveals** (hidden → generic label → identified via Bestiary;
  enemy HP shown only as healthy/bloodied/down).
- **Rules reference tab** — a quick-lookup panel for the fiddly 5e tables: which
  ability governs each skill (Acrobatics = DEX, Athletics = STR, …), the saving
  throws, proficiency bonus by level, the standard conditions, and combat
  actions. Static reference; no per-campaign state.

Both shipped (July 2026): the encounter generator landed with a
D&D-Beyond-style two-pane builder (filterable Den browser, inline stat cards),
and the rules reference as the app-level "The Rules" page. v1.0.0 launched to
production at dnd.fontao.net on 2026-07-22.

### Post-launch — v1.1.0 and v1.2.0 (July 2026)

Shipped after the v1.0.0 launch, in release order:

- **CI + first tests, the Claude Code GitHub Action** (#55, #57): Actions CI on
  every PR (Go vet/build/test · frontend typecheck/build · codegen-in-sync),
  Dependabot, and `@claude`/label-triggered automation. First committed Go unit
  tests landed alongside (auth crypto, password policy, fog geometry, encounter
  redaction).
- **The DM Menu** (#59, #60, #61) — the "manage this table" surface, in three
  parts: **see / kick / ban** players; **Table Rules** (progression mode + level
  ceiling, and the XP/milestone grant controls *moved here out of the Chronicle*
  — closing post-v1 debt item 5); and **seating approval** — a DM-toggled "at the
  door" gate where players preview a hero and request a seat the DM admits.
- **Clarity + polish**: character-creation skill/background conflicts made
  explicit (#56); server-rendered fog edge feathered instead of hard-cut (#58).
- **v1.1.0 — HTTPS enforcement** (#62): edge "Always Use HTTPS" plus an in-app
  HSTS + `X-Forwarded-Proto` redirect middleware, so the guarantee is
  version-controlled, not only dashboard config. Shipped with a compose-teardown
  fix (#63, `COMPOSE_FILE` pins the prod override) and `docs/RELEASING.md`.
- **v1.2.0 — site-wide footer** (#65): the version + credits + a repo link now
  appear on every page, not just the landing.

### Post-launch — v1.3.0 through v1.4.1 (July 2026)

- **v1.3.0 — observability** (#70, #71, #72): the Prometheus metrics listener,
  the Grafana stack, and provisioned Discord alerting (roadmap items 2 and 8).
  Later **extracted** (#93) into the homelab-wide
  [homelab-observability](https://github.com/goncalo1021pt/homelab-observability)
  repo — Quest Board is one tenant among the services it watches.
- **Staging + one-tap deploys** (#78, #79, #88): a Proxmox **staging
  environment**, and `deploy-staging.yml` / `deploy-prod.yml` running on
  self-hosted runners *inside* each VM — so a deploy is a button in the GitHub
  mobile app, with no SSH and no VPN, past a Cloudflare tunnel that has no
  inbound ports. Prod accepts only `main` or a `vX.Y.Z` tag; deploying an older
  tag is the deliberate rollback path. This was never on the roadmap and is the
  single biggest ops win since launch — see `docs/STAGING.md`, `docs/HOMELAB.md`.
- **v1.4.0 / v1.4.1** (#87, #89): the crest favicon, shipped in the binary.
- **Table-facing fixes**: delete a campaign from the DM Menu (#76), party
  summons gated behind the encounter trigger with HP synced back (#86), leaked
  next-monster headers stripped from the Bestiary (#75).

### The unversioned wave after v1.4.1 (late July 2026)

Shipped to `main`, not yet cut as a release:

- **Places + the veil** (#96): quests hang off an arbitrary-depth per-campaign
  location tree, and both places and quests reveal to the whole party or to
  individual heroes. A quest reaches a hero's board only if it *and* every
  location above it resolve visible; the party-wide flag is a reset, not a layer.
- **The Forge names its sources** (#92, #97): every option step is sifted by
  search, source book, and the codex of the table the hero must satisfy.
- **Encounter filing** (#91, #98): each fight carries a session tag and a place,
  and the library is searchable and shelved by either.
- **Species, properly** (#94, #99): full traits plus the `data.choices` model —
  a species declares the picks it asks for at creation, validated in
  `backend/internal/http/species.go` and mirrored in `frontend/src/lib/species.ts`.
- **Spell swapping** (#100): casters change spells on the trigger their class
  allows (only the wizard swaps cantrips on a long rest).
- **Veiled sheets** (#95, #104): a campaign setting that conceals party members'
  hero sheets, lifted one hero at a time.

### Post-v1 — engineering & operations roadmap (added 2026-07-22; status 2026-07-29)

v1 shipped feature-complete but with engineering debt to pay down before the
feature list grows again. **Honest status at 2026-07-29: the ops half of this
list is now done or better than planned (observability, alerting, and a staging
environment + one-tap deploys that were never even on it), and Go test coverage
quietly grew well past its target. The frontend half has gone the other way —
item 4 has now lost to three consecutive feature waves and is measurably worse
each time.**

**The one insight this list was missing: item 4 is blocked on item 1.** You
cannot safely split a 1,411-line wizard with zero frontend tests, so the
refactor never gets picked, so it grows. 58 Go tests guard ~13.8k lines of
backend; **0 tests** guard 20.1k lines of frontend — exactly the half that is
now hard to change. **Playwright first, then the split**, in that order, or
item 4 regresses a fourth time.

**Every open item below is now also a GitHub issue** (milestone *v1.6 — pay down
the debt*, or unmilestoned for the watch items), because a list that lives only
in prose loses to a list that lives in the tracker. The issues are the queue;
this section is the why.

In priority order:

1. **Automated tests + CI.** 🟡 *backend done and then some; frontend at zero.*
   → **#105** (Playwright), **#106** (codex/seating tests)
   - **CI shipped** (#55/#57): every PR runs `make generate`-in-sync, `go vet` +
     `go build` + `go test`, `tsc --noEmit`, and the frontend build.
   - **CD shipped after all** (#78/#79/#88) — the fork-PR liability was solved by
     putting self-hosted runners *inside* the staging and prod VMs, so the box
     dials out to GitHub instead of GitHub reaching in. See the v1.3.0–v1.4.1
     section above.
   - **Go unit tests: past target** — 58 test functions across 13 files. Beyond
     the original five (password, TOTP, fog geometry, encounter redaction, plus
     TLS enforcement): species choices, spell-change rules, pack book stamping,
     quest/location visibility resolution, sheet veils, bestiary, static embed,
     metrics. **Still owed: codex/seating legality** — the highest-value gap
     left, because a leak there crosses tables.
   - **Committed Playwright smoke suite: still not started** — end-to-end
     verification is still throwaway scripts. (register → forge a hero → create
     campaign → post/claim quest → trigger encounter → 2FA enroll/login.)
     **This is now the top of the list**, because item 4 depends on it.
2. ✅ *done (2026-07-24).* **Observability — Prometheus + Grafana (+ Loki).**
   The Go server is instrumented via `internal/metrics` (chi middleware for
   request rate / latency histograms / error counts / in-flight, a pgx pool
   collector, Go runtime + process stats, and game counters — quests
   created/claimed, campaigns, heroes forged, encounters run). `/metrics` is
   served on a **separate listener (`:9091`, `METRICS_ADDR`)** the tunnel never
   routes, so it cannot leak publicly. The Prometheus + Grafana +
   `postgres_exporter` + `cAdvisor` + `node_exporter` compose stack joins the
   app's docker network, scrapes everything, and auto-provisions a Grafana
   datasource + "Quest Board — Overview" dashboard. It started as this repo's
   `observability/` directory and was extracted (2026-07-27) into its own
   homelab-wide repo — Quest Board is one tenant among the services it watches:
   <https://github.com/goncalo1021pt/homelab-observability>. Still later: Loki +
   promtail (searchable logs).
3. ❌ *not started.* → **#109**. **Liveness (SSE).** The encounter tracker polls every 8s and the Chronicle
   refetches on focus; at-the-table combat deserves sub-second updates.
   Server-Sent Events fit the single-binary model (no websocket infra): one
   `/api/campaigns/{id}/events/stream` endpoint, per-campaign fan-out in the
   server, EventSource in the SPA with the current polling kept as fallback.
4. 🔴 *regressed again — the most overdue item, and now gated behind item 1.*
   → **#107** (hooks.ts), **#108** (the pages), **#113** (the backend twins).
   **Frontend refactor pass.** The goal was to split `hooks.ts` (~1,400 lines
   then) by domain and break up the biggest pages. Every measurement since has
   been worse:

   | File | at goal-setting | 2026-07-24 | 2026-07-29 |
   |---|---|---|---|
   | `hooks.ts` | ~1,400 | 1,625 | **1,906** (117 exports, 9 section comments) |
   | `ForgeWizard.tsx` | — | 922 | **1,411** |
   | `EncounterPage.tsx` | — | 774 | **1,313** |
   | `MapPage.tsx` | — | — | **1,201** |
   | `DMMenuPage.tsx` | — | 650 | **865** |
   | `HeroSheetPage.tsx` | — | — | **787** |

   Those six files are ~7.7k lines — **38% of the entire frontend**. No behavior
   change intended; purely tractability. Shape of the fix: split `hooks.ts` into
   a `hooks/` directory by domain (quests, locations, party, heroes,
   rules/forge, trees, bestiary, encounters, maps, chronicle, dm) re-exported
   from a barrel so no import churn, then extract step components out of the
   wizard and panel components out of the pages. **Do the Playwright suite
   first** — it is the safety net that makes this a mechanical change instead of
   a scary one.

   Backend equivalents worth the same treatment, less urgently:
   `encounters.go` (**1,096**) and `skill_trees.go` (**780**) — **#113**.
5. ✅ *done (#60).* **Progression menu.** The DM's XP/milestone controls moved
   out of the Chronicle block into the DM Menu's Table Rules section.
6. ❌ *not started.* → **#110**. **Encounter difficulty calculator.** Party size/level →
   easy/medium/hard/deadly XP budget with the adjusted-XP multiplier, shown live
   in the builder; `crValue` is already numeric on every monster.
7. 🟡 *partly done, and further along than planned.* → **#111**. **Ops hardening.** Nightly
   DB backups shipped with v1.0.0 (backup service in docker-compose.prod.yml,
   ./backups, 14 kept). HTTPS is enforced end-to-end (v1.1.0, #62). A **staging
   environment and one-tap deploys** landed (#78/#79/#88) — not on this list
   when it was written, and worth more than several items that were.
   **Still to do**: sync dumps OFF the VM (rclone/rsync cron — a local-only
   backup does not survive the failure it exists for); an external uptime
   monitor for dnd.fontao.net; a documented admin path for a 2FA lockout (user
   loses authenticator AND recovery codes → manual SQL today: clear `totp_*` on
   their users row).
8. ✅ *done (2026-07-24, #71).* **Alerting to Discord.** Grafana unified
   alerting, provisioned as code, pushing to a Discord channel webhook. The four
   rules shipped: app target **down** (2m, critical), HTTP **error rate high**
   (5xx > 5% for 5m), **DB pool saturated** (>90% in use for 5m), and host
   **disk nearly full** (>85%) — the last one guards the whole homelab, not just
   Quest Board. Rules/contact points/policies now live in the
   [homelab-observability](https://github.com/goncalo1021pt/homelab-observability)
   repo; the webhook URL stays in its gitignored `.env`.
9. ❌ *not started; added 2026-07-29.* → **#112**. **One rule, two implementations.**
   `species.go` ↔ `species.ts`, `spellslots.go` ↔ `spellcasting.ts`, plus
   `progression.ts` / `derive.ts` — the UI mirrors server rules so it can
   validate before submitting, and **nothing verifies the two agree**. A
   divergence shows up as a UI offering a choice the server then rejects.
   Cheap fix: shared golden fixtures asserted on both sides. Cleaner long-term
   fix: derive server-side and ship the computed fields through the contract,
   which is what the contract-first architecture is for.
10. ❌ *not started; added 2026-07-29.* → **#114**. **`openapi.yaml` is one 4,563-line file**
    (81 paths). Not painful yet; will be. Split `components/schemas` out via
    `$ref` before it doubles — `oapi-codegen` and `openapi-typescript` both
    follow refs, so this is a file move, not an architecture change.

### After the first real playtest (2026-07-30)

The first session with an actual party ran on 2026-07-30 and produced five bug
reports — #128–#132 — plus the confirmation that the debt list above was aimed at
roughly the right places. This section records **what those five actually are**
(root causes, found by reading the code rather than by guessing) and **the
sequencing decision** they forced, because the honest instinct — *"I'm mid-refactor
and not using the site, so defer all of it"* — is right for three of them and
wrong for two.

#### The finding that reframes #130

**#130 is not a Forge bug. It is every mutation in the app.** The Forge is only
where it hurt most, because the Forge is the screen with the most state to lose.

Three independent omissions stack into the reported symptom — a button that
"eternally thinks", never errors, and loses everything on reload:

1. **No request ever has a deadline.** `AbortController`, `AbortSignal` and
   `timeout` appear **zero times** in `frontend/src/`. `api/client.ts` is a bare
   `createClient({ baseUrl: "/api" })`. A `fetch` stalled on a bad connection
   stays pending, so `mutation.isPending` stays `true`, so the button stays
   disabled and captioned "Forging…" — *forever*. The Forge's error surface
   (`ForgeWizard.tsx:790`, `forge.isError`) is correct and simply never fires,
   because the mutation never settles into an error.
2. **No mutation retries.** `main.tsx` sets `queries: { retry: false }` and says
   nothing about mutations, so all **104** `useMutation` hooks across
   `hooks/*.ts` inherit TanStack's default of zero retries. One bad moment on the
   wifi is final.
3. **No draft survives a reload.** `localStorage` and `sessionStorage` appear
   **zero times** in the frontend. The wizard is `useState` end to end, so the
   reload that "fixes" the hang is also what destroys twenty minutes of
   character building.

There is a fourth, quieter one: `POST /me/characters/forge` has **no idempotency
key**, so a retry that follows a timeout can create a *second* hero when the
first request did in fact land. And server-side, `cmd/server/main.go` sets only
`ReadHeaderTimeout` — no `ReadTimeout` — so a slow client body holds a connection
open indefinitely at the other end too.

The fix therefore belongs **at the client layer, once** — a default timeout and a
bounded mutation retry in `api/client.ts` / `main.tsx` fix all 104 call sites —
not in the Forge. That is what makes it cheap enough to do now.

#### The finding that reframes #128

`SeatCharacter` (`heroes.go:87`) runs a **strict codex gate** before seating:
`sheetContentIDs` collects the hero's class, species, background *and subclass*,
**plus every spell pick and every content-backed inventory row**
(`ListCharacterContentRefs`), and `codexBlockers` (`codex.go:34`) rules homebrew
**illegal unless explicitly enabled** in that campaign.

Two consequences explain the report exactly:

- **"even the dm"** — the DM bypasses `RequireSeatingApproval`, but *nothing*
  bypasses `codexBlockers`. The codex gate applies to the DM too.
- **"in certain parties"** — it fires only in campaigns carrying homebrew or a
  ban. Heroes are forged at **account level**, outside any campaign, so the Forge
  offers everything the *user* can see; the codex then judges it against a world
  the hero was never built for. A hero forged with pack content can never enter
  a table that has not enabled that pack — and a *spell* or an *item* bars the
  door exactly as hard as a class does.

And `SummonControl` (`PartyRoster.tsx:485`) renders no error at all — no
`isError` branch — so the 409 with its perfectly good `SeatConflict.missing`
payload is thrown away and the button just does nothing. Hence "under any
circumstances", with no explanation on screen.

This is the one genuine **hard blocker**: a player cannot join a table, and the
app declines to say why.

#### The three sheet bugs

All three are the character sheet failing to *show* something the rules define.
They are not one bug, and — corrected 2026-07-30 after the reporter clarified
#129 — only one of them needs anything computed.

**#129 — the class features table is not in the app.** This is a *display and
data* gap, not a rules-engine one. The feature prose shipped from SRD 5.2 points
at a table the app does not have:

> "The extra damage increases as you gain Rogue levels, **as shown in the Sneak
> Attack column of the Rogue Features table**."
>
> "You can enter your Rage the number of times shown for your Barbarian level in
> the **Rages column of the Barbarian Features table**."

The table is the *answer* and it was never entered, so a player at the table had
to open the physical book to learn their own Sneak Attack die. Every class has
columns like this — Barbarian Rages / Rage Damage, Rogue Sneak Attack, Monk
Martial Arts die / Focus Points / Unarmored Movement, Bard Bardic die, Sorcerer
Sorcery Points, Paladin Lay On Hands, Cleric/Paladin Channel Divinity uses,
Fighter and Ranger Weapon Mastery, Warlock Invocations.

**The shape to use already exists in the data.** `data.spellcasting` is exactly
this pattern — 20-element arrays indexed by level:

```json
"spellcasting": { "ability": "INT", "cantrips": [3,3,3,4,…], "prepared": [4,5,6,7,…] }
```

So the class features table is a sibling of it: per-class named columns of 20
values on the content row's `data`, not game math hidden in Go. That placement is
deliberate — `internal/rules/spellslots.go` keeps *shared* math in Go ("game math
from the 2024 rules, not content") while per-class variation stays in content, and
**content packs are additive**, so a homebrew or pack class must be able to ship
its own table. `asiLevels` is a stray half-example of the same thing: it is a
features-table column, and it exists only on Fighter and Rogue while the other
ten rely on an "Ability Score Improvement" row in the prose. Fold it in.

Scope, honestly: this is **twelve classes of careful data entry** plus one
component that renders the table with the hero's row marked, and ideally the
hero's current value shown inline beside the feature that cites it (*Sneak Attack
— 2d6* at level 3, rather than making them read a grid). The licensing is
unchanged: these tables are in SRD 5.2 CC-BY-4.0, the same document the prose
already ships from, so nothing new is owed in `NOTICE`.

There is a second half that can wait: authoring a table for a *homebrew* class
needs a 20-row grid in `ContentForm`, whose `class` branch today handles `hitDie`,
saves and skill choices only — it already cannot edit `features` or
`spellcasting`. So homebrew classes stay hand-authored via packs for now, which is
a pre-existing gap rather than a new one.

**#131 — the sheet only reads two of the five sources.**
`HeroSheetPage.tsx:174` collects `data.features` from `klass` and `subclass` and
nothing else — not species `data.traits`, not background, not feats. That is #131
whole: the Forest Gnome keeps Darkvision, Gnomish Cunning and its lineage in the
database and the sheet simply never looks. A ~10-line change to one `useMemo`.

**#132 — AC has no override hook.** The only one of the three that needs a
computed value. `derive.ts:18` `acFromEquipment` computes `10 + DEX`, armour by
category, plus shield — with no notion of a feature *replacing* the base formula,
so Barbarian (`10 + DEX + CON`) and Monk (`10 + DEX + WIS`) are quietly wrong.
Needs a small declarative field on the feature (an ability list to sum into the
unarmoured base), read by `acFromEquipment`.

One piece of good news against #125's warning: `lib/sheet/values.ts:3` *imports*
`acFromEquipment` from `derive.ts` rather than reimplementing it, so AC is a
**single** implementation and the print exporter inherits the fix for free. The
print-vs-screen divergence #125 feared has not happened for AC.

Severity note: #132 outranks the other two even though it reads smaller. A missing
table is a *visible* absence — the player noticed it and reached for the book,
which is annoying but self-correcting. A wrong AC is a **silently wrong number
that changes outcomes**: a hit lands that should have missed, and nobody at the
table ever finds out.

**What is *not* #129.** A machine-readable resource model — expendable pools the
app tracks and spends (Rages used, Focus Points, Channel Divinity charges) — is a
separate, larger piece of work, and it is the real dependency of **#118**'s rest
mechanic, which needs pools to have anything to reset. Showing the table is not
that, does not require it, and should not wait for it. Printing the numbers is
worth doing on its own: a player who can read their Rage count off the sheet can
track uses on paper like they already do.

#### The sequencing decision

Defer-until-the-refactor-lands was assessed per issue, against the one question
that matters: **does the fix live in a file the refactor is about to rewrite?**
For most of these, it does not.

**Do now, out of order, before more of #108:**

- **#128** — hard blocker, and entirely outside the refactor's blast radius:
  `codex.go` / `heroes.go` on the backend, plus an `isError` branch in
  `SummonControl`. `PartyRoster.tsx` is not on the god-component list. There is a
  design question underneath (should a spell or an item bar the door as hard as a
  class? should the Forge filter by the *target* campaign's codex?) but the
  blocker ships before the design question is settled: surface the 409 the server
  already returns, so the DM can at least see what to enable.
- **#130 parts 1, 2 and 4** — the client-layer fixes: a default timeout in
  `api/client.ts`, bounded mutation retry in `main.tsx`, `ReadTimeout` in
  `main.go`, idempotency on the forge POST. Two small files on the frontend, both
  *outside* the six god components, and they fix all 104 mutations at once. The
  cheapest risk reduction available anywhere on this list.
- **#132** — one function, `derive.ts`, no component involved, and it fixes the
  printed sheet at the same time.
- **#131** — ~10 lines in one `useMemo`. Cheap enough that waiting for the
  `HeroSheetPage` split to land first is not worth the wrong sheet in the
  meantime.
- **#129, the data half** — entering the twelve class tables into `classes.json`
  touches no component at all, so it is refactor-proof and can be worked at any
  time, including in pieces. Do the data first and independently; it is the part
  that costs patience rather than design.

**#129's display half — right after the `HeroSheetPage` split, not before.** This
is the one new-feature item where the refactor order genuinely helps: the table
wants to be its own component, `HeroSheetPage` is 787 lines and on the #108 list,
and #108 already names *"stat block, inventory, spells, trees"* as its seams —
a features-table panel is a fifth one. Building it into the god component first
means building it twice. The data entry can land in parallel and wait for it.

**Genuinely defer, and defer on purpose:**

- **#130 part 3** (draft persistence) — this one *does* land in the middle of the
  refactor. #108 reduces `ForgeWizard` to "state + navigation", and persisting a
  draft is dramatically easier once the state is the only thing left in the file.
  Sequence it immediately after the ForgeWizard split, not before. The timeout
  fix already removes the reason players were reloading.
- **The resource model** (expendable pools the app tracks and spends) — *not*
  #129, per the correction above. The largest piece on the board, and the real
  dependency of **#118**'s rest mechanic. It wants #112's golden fixtures first so
  the Go and TS halves cannot drift while it grows. v2 work.
- **#125 / #112 / #106 / #113 / #114** — unchanged, and the playtest did not
  argue against any of them. If anything #132 argues *for* #112: a rule with one
  implementation and no test is exactly how a wrong AC reaches paper.

The principle worth keeping: **fix what stops a session, at the layer where it is
cheapest, and defer what merely annoys until its file stops moving.** The refactor
is not a reason to leave a table blocked, and a blocked table is not a reason to
abandon the refactor.

#### What the "do now" list actually became (2026-07-30)

The whole list above shipped in the order it was written, in five PRs. Three
notes where the doing taught something the planning did not know:

**#130's retry does not live where this file said it would.** The plan put a
bounded mutation retry in `main.tsx`, which is the obvious home for it and the
wrong one: TanStack hands its `retry` callback a failure with *no request
attached*, so a policy written there can only say "retry every mutation" or
"retry none". Retrying every POST invents a second hero on exactly the flaky
connection that made retrying worthwhile. It went into the transport
(`lib/http.ts`) instead, which knows the method — GET/PUT/PATCH/DELETE replay,
POST only when it carries an idempotency key.

The deadline also had to become a **budget for the whole call** rather than a
timeout per attempt. Three twenty-second attempts is a full minute of a button
reading "Forging…", which is #130 again wearing a different hat.

And forging turned out to be three writes with no transaction — the hero, their
spells, their kit. Harmless while nothing ever gave up mid-request; a deadline
is precisely something giving up mid-request, so it commits as one now.

**`asiLevels` was not folded into the features table**, contrary to the note
above. The reasoning that said "it is a features-table column" is right about
what it *is* and wrong about what to do: the ten classes lacking it are not
broken, because `levelup.go` defaults to `{4, 8, 12, 16, 19}`, and writing that
same list into ten JSON files creates a second source of truth for a rule with
no per-class variation. That is the exact drift #112 is about. Fighter and Rogue
keep theirs because they genuinely differ. (SRD 5.2 marks level 19 as *Epic
Boon* rather than an ASI; the app's `asiLevels` includes 19 because its level-up
flow offers "ASI or feat" there, which is the same choice by another name.)

**#129's data half is in, and it is 11 classes rather than 12.** The Wizard's
only columns are spell counts, which `data.spellcasting` already carries, so it
has no `featuresTable` — an absence on purpose rather than an omission. Paladin
Lay On Hands is likewise not a column in SRD 5.2; it is a formula in the feature
text. Every cell is stored as the text the official table prints ("—", "1d6",
"+10 ft."), because this is a table to *read*: the machine-readable resource
model stays where this file already put it, out in v2 with #118.

Still open from this section, unchanged: **#130 part 3** (draft persistence,
after the ForgeWizard split) and **#129's display half** (after the
`HeroSheetPage` split). The data is in the database waiting for the panel.

### The world layer opens: places get a room (2026-07-31, #103)

First of the *v2.0 — the world layer* chain (#103 → #101 → #102), and it went
first because the other two hang off it: vendors need a place to stand in, and
both quests and encounters already file by location.

**The scoping note on #103 was half wrong, in the useful direction.** It costed
reparenting as work to be done — *"one `PATCH /api/locations/{id}` that sets
`parent_id`, plus a cycle check … Small."* It already existed, and had since
#96: `UpdateLocation` takes `parentId`, refuses to move a place inside its own
descendant, and re-runs the depth cap over the moved subtree with
`heightBelow`. All of it unit tested.

What did not exist was **a way in.** The "Move inside" select sat inside an
expander opened by an unlabelled eye button titled *"Reveal hero by hero"*,
inside a modal, on the quest board. So the feature was shipped, correct, and
invisible — and the issue reporting it missing was filed by the person who
wrote it.

That is worth naming, because it is the second time in three issues: #129 was
*"Sneak Attack is missing"* about a feature whose full rules text was already on
screen. **A capability nobody can find is indistinguishable from one that does
not exist, and the bug report will describe it as missing.** The endpoint test
passes either way, which is exactly why neither was caught by one.

So the work was mostly the room, not the mechanism:

- **`/campaigns/:id/places`**, a page rather than a board modal. The DM gets the
  cartographer's table; players get a **gazetteer** — the places they have been
  let in on, in the same nesting, and no trace of the ones they have not. The
  filtering is the server's already; the page never sees a veiled place.
- **Reparenting moved to the pencil**, where someone looking to edit a place
  actually looks.
- **Descriptions became writable.** `locations.description` has been in the
  schema and the API since #96 and **no screen ever set it** — it was empty in
  every campaign that has ever existed. A hub page with no room for prose is a
  filing dropdown with a bigger heading.
- **The counts became doors.** A place links to the board filtered to it and to
  the encounters prepared for it. The board's place filter moved from component
  state into `?place=`, which is what made the link possible and incidentally
  makes a narrowed board shareable.

Not done, deliberately: the place tree is still nowhere near the battle maps
(#109's territory) and a place still cannot be pinned to a map region. That is a
real connection and it wants the map work, not this page.

#### The bug the screenshot found

Worth recording because of *how* it surfaced. A throwaway script that set up a
nested map for a screenshot renamed two places over the API — and the child
jumped to the root of the map. Nothing in the app did this; nothing in the app
could, because the one screen that calls the endpoint always sent every field.

`PATCH /locations/{id}` wrote `parent_id` straight from the request body, and
once decoded **an absent field and an explicit null are the same nil**. So any
body that did not mention the parent read as *"make this a root"*. A rename
detached the place, took everything nested inside it along, and — because
visibility resolves up the ancestor chain — **lifted the veil on anything down
there that was dark only because an ancestor was veiled**. A rename, silently
showing the party a place the DM had not revealed.

Two things generalise:

- **The trap is in the type, not the handler.** No amount of care in
  `UpdateLocation` could distinguish the two cases, so "remember to send
  `parentId`" was the only defence, and a defence that lives in the caller's
  memory is not one. Moving is now `PUT /locations/{id}/parent`, where the
  field is required and saying nothing is not a possible input. The update
  endpoint cannot touch the tree at all. Same shape as the visibility
  sub-resource next to it, which got this right first.
- **This is the argument for driving the thing you built.** The unit tests
  passed, the e2e suite passed, and the endpoint had been wrong since #96. It
  took *looking at the page* — and a setup script written the way an outside
  caller would write one — to find it. The regression test is at the API layer,
  not through the UI, because the UI was never the thing that got it wrong.

### The next waves (planned 2026-08-04)

With both milestones closed (*v1.6 — pay down the debt*, *v2.0 — the world
layer*) and v1.6.0 released, the open backlog — seven findings from the
2026-08-03 menu review plus three user-filed ideas — was ordered into four
waves, each a milestone:

- **v1.7 — the campaign menus**: the menu-review cleanups. A player menu in
  campaign with a leave action and a max-seated-heroes-per-player dial,
  default 1 (#171); the DM bench — unseat a hero without kicking the player
  (#179); navigation polish — a Skill Trees tile, doors to the hero sheet,
  Den ↔ Bestiary cross-links, an in-campaign rail, copy repairs (#178).
- **v1.8 — resource pools** (#175): the piece this file has called the
  largest on the board, its dependencies now met — #112's golden fixtures
  guard the two rule implementations and #118's rests are the consumer that
  refills the pools. Spell slots are the precedent: server-owned, ± from the
  sheet. One design rule settled up front: pools do **not** parse the
  `featuresTable` display text ("1d6", "—"); they get their own small
  machine-readable declaration on class `data`, so packs can ship their own.
- **v1.9 — running the fight**: conditions + death saves on the tracker
  (#173) and the opt-in shared roll log (#176), both riding the SSE stream
  (#109) that already pushes tracker updates.
- **v1.10 — the living world**: the Bazaar takes money (#174 — the backend
  already accepts price/qty, the UI never sends them; the new piece is the
  buy transaction) and Chronicle handouts (#177, reusing the map upload path).

Parked without a milestone, on purpose: character sharing (#180) until its
design is sketched, and friends/chat (#181) until the table asks for it — the
Chronicle's player channel already covers party chat.

**Versioning, settled the same day: the v2 label is retired from planning
vocabulary.** The *v2.0 — the world layer* milestone shipped inside the
v1.6.0 release, which proved the milestone names and the tags had drifted
apart. From here the convention is the normal one — waves count v1.7, v1.8, …
and a 2.0.0 tag waits for a genuinely breaking change, not a headline feature.

## How work is tracked (decided 2026-07-29)

Three intake channels had grown with no single queue: this file (strategy),
GitHub issues (asks from playtesting), and verbal recommendations from people at
the table that landed nowhere. The split from here:

- **This file is the decisions-and-why record.** What was chosen, what was
  rejected, and what shipped. It is not a task list — the debt list above lived
  *only* here, which is exactly why it lost to issues every single sprint:
  issues are visible, prose is not.
- **GitHub issues are the only work queue**, including the numbered debt items
  above — filed 2026-07-29 as #105–#114. Milestones group them into releases:
  *v1.6 — pay down the debt* (the engineering list) and *v2.0 — the world
  layer* (#103 places hub → #101 gear schema → #102 NPC vendors, in that order;
  each depends on the one before).
- **`from-the-table` labels playtest feedback** — the recommendations people
  make out loud during a session, captured the moment they are said rather than
  remembered later.

## Open questions

Genuinely still open:
- Exact landing-page composition (v0 base "still needs work").
- The full personal visual design pass for the skill-tree web (engine shipped
  functional; the bespoke look is deferred — "think about later").

Settled (kept for the record):
- **Branding** → **Quest Board**. The design-package alternates (QuestBoard /
  The Tavern / Emberhall) are retired; Quest Board is used across the shipped UI
  and the dnd.fontao.net deploy.
- **Encounter generator — player-visibility model** → shipped: shared read-only
  tracker, DM-controlled reveals (hidden → generic label → identified via
  Bestiary; enemy HP only as healthy/bloodied/down).
- **Instance access** → **open server**, decided 2026-07-24 (see the content-
  trust model above): sign-ups are open, no invite/approval gate by choice.
- **Repo visibility** → **public**, and staying so: portfolio value, the footer
  now links to it from every page, unlimited Actions minutes, free
  Dependabot/code scanning; git history verified clean of secrets. Revisit only
  if book-content hygiene ever becomes hard to guarantee.
