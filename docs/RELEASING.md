# Releasing

**The git tag is the version.** There is no version file to bump, no release PR
to merge, and nothing to keep in sync — the build stamps the tag into the binary
(`backend/internal/version`), so what the app reports and what the tag says can
never disagree.

Cutting a release and putting it in front of players are two separate taps, on
purpose: you can cut a release for the record and deploy it after a session
rather than mid-game.

## 1. Cut the release

> GitHub → this repo → **Actions** → **Cut a release** → **Run workflow** →
> pick `patch` / `minor` / `major` → **Run**.

That is the whole thing. `.github/workflows/release.yml` reads the last tag,
raises the part you chose, and — after checking that **CI is green on the exact
commit** it is about to tag — creates the annotated tag and publishes a GitHub
release whose notes are built from the merged PR titles since the last one.

Which part to raise:

- **Patch** (1.0.x) — only bug fixes.
- **Minor** (1.x.0) — any new user-facing feature, backward compatible.
- **Major** (x.0.0) — breaking change (players or DMs must relearn something,
  or data/API compatibility breaks).

Tick **dry run** to see the version it would pick and the commits it would cover
without creating anything.

It refuses to tag when CI is not green on that commit, when nothing has landed
since the last tag, or when the version already exists.

## 2. Deploy it

> GitHub → **Actions** → **Deploy to production** → **Run workflow** → type the
> tag (`vX.Y.Z`) → **Run**.

That workflow snapshots the database before migrating, waits for health, checks
the public URL, and rolls the code back on its own if the deploy fails. Details
and the manual fallback live in `docs/DEPLOY.md`.

Deploying an older tag is also the deliberate rollback path.

## 3. Verify live

```bash
curl -s https://<your-domain>/api/auth/config   # "version":"X.Y.Z"
```

Also eyeball the footer (shows the version on every page) and `make ps` on the
VM (app healthy, backup running).

## How the version reaches the binary

`make` computes it from `git describe --tags --always --dirty` and passes it to
the Go linker; `backend/Dockerfile` takes the same value as a `VERSION` build
arg, which `docker-compose.yml` feeds from the environment.

```bash
make version    # what this tree would build as
```

- On a release tag: `1.7.0`
- On main, past a tag: `1.7.0-12-gabc1234` — honest about not being a release
- With uncommitted edits: `…-dirty`
- Unstamped (`go run ./cmd/server`, or a build that skipped the flag):
  `0.0.0-dev`, which is meant to look wrong rather than quietly claim to be
  last year's release

## Why no release bot

`release-please` and friends work by opening a release PR. A PR opened with the
default `GITHUB_TOKEN` never triggers CI, so its required checks would sit
pending forever against the **Main** ruleset, which has no bypass actors. The
fix is handing a bot a long-lived token that can write to `main` — a bigger
price than a version file is worth. Tagging needs none of that.

If this ever publishes artifacts (binaries, a registry image, a Homebrew tap),
[goreleaser](https://goreleaser.com) is the natural next step: it consumes tags,
so this arrangement is already the on-ramp.
