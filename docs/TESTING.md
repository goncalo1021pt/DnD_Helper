# Testing

Three layers, and each one exists because the layer above it cannot see the
thing it protects.

| Layer | What it guards | Where | How to run |
|---|---|---|---|
| Go unit tests | rules, permissions, geometry, redaction | `backend/**/*_test.go` | `cd backend && go test ./...` |
| Typecheck | the contract between spec, server and SPA | `tsc` | `cd frontend && npm run build` |
| **Playwright e2e** | that the pieces are still wired together | `frontend/e2e/` | `make test && make e2e` |

## The e2e suite

Issue #105. It exists to be the safety net under the frontend refactor
(#107, #108), and it has already earned that: `hooks.ts` (1,906 lines) became
`hooks/` in #107, and `ForgeWizard.tsx` went 1,411 → 951 across #121 and #123,
each verified by this suite rather than by hope. `EncounterPage.tsx` (1,313)
and `MapPage.tsx` (1,201) are still to come.

It drives the **real stack** — Go binary, embedded SPA, Postgres — not a mocked
frontend. A test that mocks the API cannot tell you that splitting `hooks.ts`
broke the wiring between the two, which was the entire risk being covered —
and is still the risk for every file left on that list.

### Running it

```bash
make test          # whole app in containers at :8080 (dev login on)
make e2e           # Playwright against it, in Docker (no Node needed on the host)

make e2e ARGS=forge          # one spec
make e2e ARGS="--headed"     # watch it
E2E_BASE_URL=https://staging.example make e2e   # point it elsewhere
```

`make e2e` refuses to run if nothing answers at `E2E_BASE_URL`, rather than
producing a screenful of timeouts.

### What it covers

| Spec | Journey | Protects |
|---|---|---|
| `smoke.spec.ts` | DM founds a table → posts a quest → player joins by invite code → claims it | the spine: auth, campaign hall, board, invite gate, membership |
| `forge.spec.ts` | the whole 2024 wizard (Class → Background → Species → Abilities → Gear → Name) → hero sheet | `ForgeWizard.tsx`, `HeroSheetPage.tsx` |
| `forge.spec.ts` | a background that eats a class skill pick is explained, and blocks the forge | the #56 conflict rules |
| `encounter.spec.ts` | prepare from the Den → trigger → initiative tracker | `EncounterPage.tsx`, `DenPage.tsx` |
| `auth.spec.ts` | register → unverified nudge; the emailed link; 2FA enrolled then demanded at the door | the front door |
| `map.spec.ts` | the fog holds pixel-for-pixel; DM-only pins never reach a player; sub-maps; a stranger gets 403/401 | `MapPage.tsx`, the fog compositor, the hand-rolled image route |
| `notifications.spec.ts` | the email defaults on the profile and a change kept; the chronicle refused by email; a mute set from the Player Menu; the table's channel gets a Discord-shaped message for a notice born visible and nothing for a veiled one, and (#344) a draft revealed to one hero of two posts nothing, revealed to the table it posts, XP posts once per hero; a Discord-format hook without a secret; the unsubscribe page | `NotificationsSettings.tsx`, `HeraldSection.tsx`, `internal/notify`, `Fanout` and `Event.Public` |
| `webhooks.spec.ts` | a receiver inside the test process, reached at `E2E_RECEIVER_HOST` (the Makefile passes `host.docker.internal` for the containerized app; CI's native binary uses the default, loopback): a hook registered on the profile gets a signed delivery for a posted quest and none for a drafted one; a ping; a token-born hook is refused a name past its scopes and never hears one; a dead URL shows a failed attempt with its next try | `internal/webhooks`, the handlers in `webhooks.go`, `WebhooksSettings.tsx` |
| `export.spec.ts` | a player's document: their hero as the sheet reads, the table with the visible notice and not the draft, images as URLs, homebrew; the DM's has the draft; a token holding only `account:read` gets the account and `omitted` names the rest, one holding `heroes:read` too gets the heroes; the profile button downloads a file | `export.go`, `MeExport`, the profile's Your data section |
| `feed.spec.ts` | the catalogue seen through the DM's feed: a visible notice is an event for who can see it and a drafted one is none, a reveal reaches only the newly told, a claim, a session set then moved, XP, a chronicle line, a seat request for the DMs alone; a player cannot read the feed | `internal/events`, `audience.go`, `emit.go`, `feed.go` |
| `ratelimit.spec.ts` | a token hammering the codex meets its ceiling → 429 with `Retry-After` → the profile row says *hit its ceiling*; a session's page-load burst never meets one | `rateLimit`, `routeCost`, the badge in `ApiTokensSettings.tsx` |
| `tokens.spec.ts` | mint on the profile → the bearer opens the doors it names and no other → revoke shuts it; a token tied to one table sees that seat alone | `ApiTokensSettings.tsx`, `auth.BearerLoader`, the scope gate, `tableAllowed` |

Not covered yet: the DM Menu, skill trees, the codex, and the character-sheet
exporter (`lib/sheet/` — see #125, which wants unit tests rather than a browser
journey). Add them as the refactor reaches those files.

The map *is* covered, as of #122 — and it is the model for anything else where
the guarantee is about what the server sent rather than what the DOM shows.

### Two rules that keep it from getting brittle

1. **Every run makes its own users and campaigns**, suffixed unique. Nothing is
   shared and nothing is cleaned up — a failed run leaves its wreckage for
   inspection instead of poisoning the next one.
2. **Setup that is not the thing under test goes through the API.** A test
   about the encounter tracker should fail when the tracker breaks, not when
   the registration form moves. Use `page.request` (not the bare `request`
   fixture) so the session lands in the browser's cookie jar.

### Email, and a footgun

Registration sends a verification email. With **no `RESEND_API_KEY`** the server
falls back to `logMailer` and prints the message — that is how
`auth.spec.ts` follows the confirmation link, via `E2E_SERVER_LOG` pointing at
the server's log file. Without that variable the test skips itself rather than
pretending to pass.

**Run the suite against a server that has no `RESEND_API_KEY`.** Your local
`.env` probably has the real one, in which case every run fires real Resend
calls for addresses that do not exist. CI leaves the key unset on purpose.

### Versions

`@playwright/test` in `frontend/package.json` is pinned **exactly**, and
`PLAYWRIGHT_VERSION` in the `Makefile` must match it — the library refuses to
drive browsers it did not ship with. Bump both together.

### In CI

The `e2e` job in `.github/workflows/ci.yml` runs on every PR: Postgres service
container, `make build`, start the binary, run the suite. It retries once (real
browsers are not perfectly deterministic) and uploads the Playwright report,
traces and the server log as artifacts when it fails, so a failure is
diagnosable without reproducing it locally.
