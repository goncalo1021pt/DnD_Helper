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
lives in the user's campaign notes). **Engine built July 2026** (branch
`skill-trees`, in user testing): the Loom (tree/node/edge editor), pacts,
DM-granted picks, reachability-gated spending, party-card integration, and a
functional SVG web view — demoed with a 50-node six-limb Vecna web. Still
open before PR: user testing; then later a full personal visual design pass
(user note: "full personal design, think about later"). Engine principles,
all agreed:
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
with a public deployment (questboard.fontao.net) in mind:
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
- Still owed before public go-live: an instance front door (invite code /
  approval), since OAuth authenticates but does not authorize.

### v1 build-out — shipped (July 2026)

The builder, the skill-tree engine, and the campaign's full table toolset all
landed. Merged to `main`:

- **The Forge + hero sheets** (#22 onward): the 2024 creation wizard (Class →
  Background → Species → Abilities → Spells → Gear → Name), account-level heroes
  seated into campaigns, level-ups, spell-slot tracking, inventory + AC/attack
  math, and a solo hero-sheet page. The Dice Tower rides along wherever you roll
  (forge, sheet, and above modals for HP rolls on level-up).
- **Content pipeline**: content-as-data (class / species / background /
  subclass / feat / spell / item / monster), the Scribe's Desk editor, the
  per-campaign **codex** (propose / enable / ban) with **strict seating**,
  private **pack import/export**, the SRD 5.2.1 seed, per-book source labels,
  and collapse of the same official entry imported by several users.
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

## Open questions
- **Branding**: repo says Quest Board; designs use QuestBoard / The Tavern /
  Emberhall. Settled in practice on **Quest Board** (used across the shipped UI
  and the fontao.net deploy); the alternates are retired.
- Exact landing-page composition (v0 base "still needs work").
- **Encounter generator — player-visibility model** (see Planned before v1).
