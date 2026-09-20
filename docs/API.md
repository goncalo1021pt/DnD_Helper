# The API

Quest Board is one HTTP API and a browser that happens to sit in front of it.
Everything the tavern does — the board, the codex, the heroes, the atlas — is a
JSON endpoint under `/api`, described by the OpenAPI contract at
[`openapi.yaml`](../openapi.yaml). A script or an assistant walks in through
the same doors the browser does, holding a **token** instead of a cookie.

- Base URL: `https://dnd.fontao.net/api` (a self-hosted stack: `http://<host>:8080/api`)
- Contract: `openapi.yaml` at the repo root — paste it into any OpenAPI viewer or
  hand it to the assistant that will be calling
- Every response is JSON; refusals carry `{"error": "..."}`

## Minting a token

Tokens are minted on your **profile, under Settings → API tokens** — in a
browser, signed in. There is deliberately no endpoint a token can call to mint
another: a token that could grow itself would never really be revoked. The
secret is shown once. Copy it then; the server keeps only its hash and cannot
show it again.

A token carries:

| Field | Meaning |
|---|---|
| **scopes** | what kind of thing it may touch — see below |
| **campaign** (optional) | one table it is confined to; absent means every table you sit at |
| **expiry** | 30, 90 (the default) or 365 days, or never |

Send it as a bearer:

```bash
curl -H "Authorization: Bearer qb_..." https://dnd.fontao.net/api/me
```

Every token opens with `qb_`, so one found in a log or a repository can be
recognised. The first eleven characters are listed beside its name on the
profile, so a leaked one can be matched to its row and revoked.

## Scopes

A scope says what *kind* of thing may be touched; the handler still decides who
you are to it, exactly as it does for the browser. A `heroes:write` token can
rest **your** heroes, not somebody else's; a `campaigns:run` token runs the
tables **you** DM. A scope never grants what your account could not do itself.

| Scope | Reaches |
|---|---|
| `rules:read` | the codex — classes, species, backgrounds, feats, spells, items; the SRD and your homebrew; a DM's monsters at their tables |
| `rules:write` | author, edit and import homebrew (never the one-call reset, which is session-only) |
| `heroes:read` | your heroes' sheets, inventory, spells, creatures |
| `heroes:write` | forge, level up, rest, equip, prepare spells |
| `campaigns:read` | the tables you sit at — the board, atlas, chronicle, roster, Folk, bestiary |
| `campaigns:play` | act as a player — claim a quest, buy, roll, write a chronicle note, ask a seat |
| `campaigns:run` | run a table as its DM — quests, fog, encounters, the Folk, handouts, vendors |
| `campaigns:own` | the cascading strikes — disband, strike a map or place, delete a tree, hand a table over |
| `account:read` | who you are, your friends, your messages |
| `account:write` | profile, friendships, messages |
| `webhooks:read` | your webhooks and their delivery logs |
| `webhooks:write` | register, ping, re-enable and remove them — a hook born of a token hears no more than the token could read (see Webhooks) |

Within a domain a higher rung implies the lower — `campaigns:run` reads and
plays; `heroes:write` reads. Across domains nothing implies anything.

Two rules hold across the whole contract:

- **A `:read` scope only ever sits on a GET, and every GET is a read.** Hand an
  assistant `rules:read` + `heroes:read` and it cannot change a thing.
- **The strikes are `campaigns:own`.** A leaked bot token minted with `run` can
  make a mess of a session; it cannot erase a map or disband the table.

Each operation in `openapi.yaml` declares the one scope it needs under
`security`. A call without it is refused with **403** and the name of the
missing scope; a bad, expired or revoked token is refused with **401** on the
spot, whatever cookie rode along.

## A token tied to one table

Restrict a token to a campaign and it sees the tavern from that one seat:

- any door onto another table is refused as it would be for a non-member
- `GET /me` lists only that campaign
- `GET /me/characters` lists your heroes there plus your unseated ones; a hero
  seated elsewhere is invisible
- founding a table or joining one is refused (**403**) — the token was told
  where it lives

## What a token can never do

These are **session-only**: they answer only to a signed-in browser, never a
bearer.

- sign in, register, change the password, 2FA — everything under `/api/auth`
- list, mint or revoke tokens — `/api/me/tokens`
- the homebrew reset — `DELETE /api/rules/homebrew`

## Limits

Every request draws from a bucket. The bucket refills at a steady rate and
holds a burst of twice that, so a script can open with a flurry and then
settle. When it is empty the answer is **429** with a `Retry-After` header in
whole seconds and the usual `{"error": ...}` body. Wait that long and carry
on — nothing was lost.

| Ceiling | Sustained | Burst |
|---|---|---|
| per token | 60 requests a minute | 120 |
| per IP, for bearer and anonymous requests | 300 a minute | 600 |
| per signed-in browser | 600 a minute | 1,200 |

A token draws from its own bucket and from its IP's, so many keys on one host
still share a ceiling. A browser session draws from the person's alone, so a
table on one Wi-Fi never shares one.

Heavy doors cost more than one request's worth: the codex lists
(`GET /rules/{kind}`) and a map image draw **5**, a pack import or export and
a map upload draw **10**. Walking every shelf of the codex is about 50 — well
inside one burst — and after that a dozen shelves a minute.

A token that hits a ceiling is marked on the profile (*hit its ceiling*, with
the time), so the person who minted it learns their script is looping without
reading a log.

The numbers above are the defaults. A self-hosted stack tunes them with
`RATE_LIMIT_TOKEN_PER_MINUTE`, `RATE_LIMIT_IP_PER_MINUTE` and
`RATE_LIMIT_SESSION_PER_MINUTE`; 0 turns a ceiling off.

Also:

- 25 live tokens per account; revoke one to mint another
- `lastUsedAt` is written at most once a minute per token — a busy script costs
  one write, not one per request

## Events

Everything that happens at a table is also an **event** (#315): a name, a
payload of ids plus the names a reader needs, and an audience — the people who
may hear it, decided when it is emitted by the same veil the thing itself has.
A quest's audience is who can see the quest; a handout's is who it was handed
to; a level-up's is the hero's owner and the DMs. Webhooks (#295) and
notifications (#316) deliver from it, and every event is recorded, so a DM
reads the record:

```
GET /campaigns/{campaignId}/feed?limit=50      campaigns:read, DMs only
```

Each entry is a `CatalogueEvent`: `id`, `name`, `at`, `campaignId`, `actor`
(who did it), `audience` (user ids — on the feed only, never on a delivery),
and `payload`. The catalogue:

| Event | When | Audience | Payload |
|---|---|---|---|
| `quest.posted` | a notice reaches the board for someone — posted visible, or revealed later | who can now see it | `QuestEventPayload` |
| `quest.claimed` | a member takes it up | who can see it | `QuestEventPayload` with `claimedBy` |
| `quest.completed` | the DM marks it done | who can see it | `QuestEventPayload` |
| `handout.given` | a prop reaches someone for the first time | who it reached | `HandoutEventPayload` |
| `session.scheduled` | the next gathering is set where there was none | everyone | `SessionEventPayload` |
| `session.moved` | the next gathering changes date | everyone | `SessionEventPayload` with `previousAt` |
| `hero.levelled` | a seated hero rises a level | the owner and the DMs | `HeroLevelEventPayload` |
| `hero.xp_awarded` | the DM grants or docks XP — one event per hero | the owner and the DMs | `HeroXpEventPayload` |
| `encounter.started` | a fight goes live | everyone | `EncounterEventPayload` |
| `encounter.ended` | a fight stands down | everyone | `EncounterEventPayload` |
| `chronicle.written` | somebody writes in the chronicle | everyone | `ChronicleEventPayload` (a 140-character excerpt) |
| `member.joined` | somebody walks in with the invite code | everyone | `MemberEventPayload` |
| `seat.requested` | a player asks the DM for a seat | the DMs | `SeatEventPayload` |

A reveal announces only to the people it reaches for the first time: revealing
a quest to a second hero does not tell the first again. The payload schemas
are in `openapi.yaml` under `components`, one per row above.

## Webhooks

A webhook (#295) is your standing order: tell this URL when these events
happen. It belongs to you, and it hears only what you could see in the app —
the audience the emitter decided (see Events) is the only gate, so a player's
hook never learns of a quest their DM keeps veiled.

Register one on your profile under **Settings → Webhooks**, or through the
API:

```
GET    /me/webhooks                        webhooks:read
POST   /me/webhooks                        webhooks:write   {url, events[], campaignId?}
DELETE /me/webhooks/{id}                   webhooks:write
POST   /me/webhooks/{id}/enable            webhooks:write   after it was disabled for failing
POST   /me/webhooks/{id}/ping              webhooks:write   a test delivery
GET    /me/webhooks/{id}/deliveries        webhooks:read    the last twenty, with status
```

`events` is a list of catalogue names, or empty for all of them; `campaignId`
confines it to one table you sit at. The answer to `POST` carries the signing
**secret once**, and never again. Ten webhooks per account.

**A hook born of a token hears no more than the token could read.** Every
event belongs to a read scope — `heroes:read` for `hero.levelled` and
`hero.xp_awarded`, `campaigns:read` for everything else — and a hook
registered through a token records that token's scopes and its table
restriction. Naming an event the token could not read is refused with 403
naming the scope, and an unfiltered hook simply never hears it. So
`webhooks:write` on its own reaches nothing: mint the read scopes the hook
should hear beside it. A hook made in a browser has no such cap.

### What you receive

A `POST` of JSON — the catalogue envelope without the audience, plus the
table's name:

```json
{
  "id": "…",                          the event's id, the same at every hook it reached
  "name": "quest.posted",
  "at": "2026-09-18T20:15:00Z",
  "campaign": {"id": "…", "name": "The Sunless Citadel"},
  "actor": {"id": "…", "name": "Gonçalo"},
  "payload": {"questId": "…", "title": "Rats in the cellar", "difficulty": "medium", "status": "available"}
}
```

With headers:

| Header | |
|---|---|
| `X-QuestBoard-Event` | the event name, or `ping` |
| `X-QuestBoard-Delivery` | this delivery's id — a retry carries the same one |
| `X-QuestBoard-Timestamp` | unix seconds when it was sent |
| `X-QuestBoard-Signature` | `sha256=` + hex HMAC-SHA256 over `timestamp + "." + body`, under your secret |
| `User-Agent` | `QuestBoard-Hookshot/<version>` |

Answer with any 2xx within ten seconds. Verify the signature before trusting
a body — the timestamp is inside the signed text, so a captured delivery
cannot be replayed with a fresh header; refuse one older than a few minutes:

```python
import hmac, hashlib
expected = "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, signature)
```

### Retries, and a URL that is gone

A delivery that gets no 2xx is tried again after about a minute, then five,
thirty, and two hours — five attempts, then it is **dead**. Eight dead
deliveries in a row and the hook is **disabled**: you get an email if your
address is confirmed, the profile says why, and a button re-enables it with
the count cleared. Nothing is lost on this side — the events stay recorded —
but nothing more is sent there until you do.

Redirects are never followed. In production the URL must be `https` and must
not resolve to a private, loopback or link-local address, checked at the dial:
this server sits on a LAN and will not be turned into a probe of it.

### A Discord channel

A Discord incoming webhook is a webhook wearing a different body (#316):
register it with `format: discord` and it receives a message Discord renders —
one line saying what happened, the time as Discord's own timestamp tag so it
reads in each viewer's zone, and a link to the table — instead of the signed
envelope. It is unsigned, so the answer to `POST` carries no secret. The
profile form picks the format by the URL's shape; through the API, say so:

```
POST /me/webhooks   {url, events[], campaignId?, format: "discord"}
```

Mentions are switched off in what is posted (`allowed_mentions: {parse: []}`):
a quest title is somebody's own text and must not ping a channel.

## Notifications

What reaches you *outside* the app (#316): email to your confirmed address,
and — through the webhooks above — a Discord channel of your own. A new
account is told about the next gathering and a handout to it, and nothing
else, until it says otherwise.

```
GET /me/notifications                          account:read
PUT /me/notifications                          account:write   {emailEvents[]}
PUT /campaigns/{campaignId}/mute               campaigns:play  {muted}
```

`emailEvents` is the list of catalogue names that reach your inbox; empty is
none. `chronicle.written` is not offered by email — a line per line is a
flood — and is refused with 400. Nothing is sent to an address that has not
been confirmed; the choices are kept for when it is. A **mute** is a fact
about your seat at one table: no email about that table while it holds,
whatever the list says, and leaving the table drops it. Webhooks are
untouched by a mute, since a webhook is an integration rather than a notice.

Every notice carries a link that stops them all — the same page as the
`List-Unsubscribe` header a mail client shows as a button — and the profile
turns them back on one event at a time.

### The table's own channel

A DM may hang a Discord channel on the table itself:

```
PUT    /campaigns/{campaignId}/channel         campaigns:run   {url, events[]}
DELETE /campaigns/{campaignId}/channel         campaigns:run
POST   /campaigns/{campaignId}/channel/ping    campaigns:run
```

It is a webhook with no owner, and having no owner it is not selected by
the audience the way a person's hook is: it hears an event only when the
audience is **the whole table**. A notice for the party, the next
gathering, a handout to everyone reach it; a handout to one hero, a seat
request, a veiled notice never do, whatever `events` names. It rides the
`Campaign` payload as `channel` for DMs alone — whoever holds the URL can
post to the channel — and when it dies of a URL that is gone, every DM with
a confirmed address is told. Setting it again re-enables it.

## Reading it as an assistant

The bundled contract is the whole vocabulary. A workable first prompt:

> Here is an OpenAPI file and a bearer token. List my heroes, then fetch each
> one's sheet and the rules entries for its class and species, and tell me what
> I can do at level 5.

The paths that matter for that: `GET /me`, `GET /me/characters`,
`GET /characters/{id}`, `GET /rules/{kind}` and `GET /rules/content/{id}`.
