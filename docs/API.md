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

- 25 live tokens per account; revoke one to mint another
- `lastUsedAt` is written at most once a minute per token — a busy script costs
  one write, not one per request
- rate limits per token are #314, in the same release

## Reading it as an assistant

The bundled contract is the whole vocabulary. A workable first prompt:

> Here is an OpenAPI file and a bearer token. List my heroes, then fetch each
> one's sheet and the rules entries for its class and species, and tell me what
> I can do at level 5.

The paths that matter for that: `GET /me`, `GET /me/characters`,
`GET /characters/{id}`, `GET /rules/{kind}` and `GET /rules/content/{id}`.
