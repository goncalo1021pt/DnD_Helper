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
  the Tavern" → app). The app lives under `/questboard` and
  `/questboard/campaigns/:id`; logged-out visits redirect to `/`.

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
- Chronicle / activity feed — needs backend events
- ~~Next-session countdown~~ — **done (July 2026)**: `next_session_at` on
  campaigns, DM schedules/clears via the toolbar chip, everyone sees the
  ticking countdown.
- ~~Dice roller~~ — **done (July 2026)**: floating "Dice Tower" tray on every
  app page — d4–d100 + coin, modifier, d20 crit/fail call-outs, roll history.
  Client-side only; shared rolls could land in the Chronicle later.
- Quick actions — depends on what exists by then

Each backend-touching feature follows the established flow: migration + queries
→ `openapi.yaml` → `make generate` → handlers → hooks.

### Later
- Character builder with two custom skill-tree systems (2024 / 5.5e rules) —
  the long-standing Phase 2+ goal from the README. The party roster's
  characters are the seed: roster entries should grow into full sheets.
- **XP system**: track XP per character, with the DM giving or taking XP
  depending on the campaign's progression mode (e.g. XP vs milestone).
  Its own PR, after the Party Menu settles.

## Open questions
- **Branding**: repo says Quest Board; designs use QuestBoard / The Tavern /
  Emberhall. Undecided.
- Exact landing-page composition (v0 base "still needs work").
