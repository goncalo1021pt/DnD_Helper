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
(#107, #108): `hooks.ts` is 1,900 lines, `ForgeWizard.tsx` 1,400, and
`EncounterPage.tsx` 1,300, and nobody splits files that size without one.

It drives the **real stack** — Go binary, embedded SPA, Postgres — not a mocked
frontend. A test that mocks the API cannot tell you that splitting `hooks.ts`
broke the wiring between the two, which is the entire risk being covered.

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

Not covered yet, deliberately: the map and fog (canvas — needs image
assertions), the DM Menu, skill trees, the codex. Add them as the refactor
reaches those files.

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
