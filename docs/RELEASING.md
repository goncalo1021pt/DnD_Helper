# Releasing

The release process, start to finish. `backend/internal/version/version.go`
(`version.Current`) is the single source of truth — the git tag, GitHub release,
and landing-page footer must all match it.

## 1. Decide the version (semver)

Compare `main` against the last release tag:

```bash
git log --oneline v1.0.0..main
```

- **Patch** (1.0.x) — only bug fixes.
- **Minor** (1.x.0) — any new user-facing feature, backward compatible.
- **Major** (x.0.0) — breaking change (players/DMs must relearn something,
  or data/API compatibility breaks).

## 2. Open the release PR

`main` is protected — every change lands via PR, releases included.

```bash
git checkout -b release/X.Y.Z main
# edit backend/internal/version/version.go → Current = "X.Y.Z"
git commit -am "release: vX.Y.Z"
git push -u origin release/X.Y.Z
gh pr create --base main --title "release: vX.Y.Z"
```

Wait for the three CI checks, then merge on GitHub.

## 3. Tag the merge commit

The tag must point at the commit on `main` that contains the version bump —
never at the branch tip that got squashed away.

```bash
git checkout main && git pull
git tag vX.Y.Z        # annotate if you like: -a vX.Y.Z -m "..."
git push origin vX.Y.Z
```

Mind the `v` — the tag is `v1.2.0`, not `1.2.0`. Pushing a name that doesn't
exist locally fails with `src refspec … does not match any`; if you mistyped it,
`git tag -d <wrong>` and re-tag (an unpushed tag is free to delete).

## 4. Publish the GitHub release

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

`--generate-notes` builds the changelog from merged PR titles since the last
tag; edit afterwards on GitHub if the wording needs love.

## 5. Deploy to production

On the VM (see `docs/DEPLOY.md`; VPN must be up):

```bash
ssh goncalo@<vm-host>
cd DnD_Helper
git pull        # now on the tagged main
make prod       # docker compose --profile full up -d --build
```

`COMPOSE_FILE` in the server's `.env` applies the production override, so no
`-f` flags are needed. The build takes a few minutes and the old container keeps
serving the whole time; the only downtime is the few seconds of the container
swap at the end.

## 6. Verify live

```bash
curl -s https://<your-domain>/api/auth/config   # "version":"X.Y.Z"
curl -sI https://<your-domain> | grep -i strict-transport-security
```

Also eyeball the footer (shows vX.Y.Z on every page) and `make ps` on the VM
(app healthy, backup running).
