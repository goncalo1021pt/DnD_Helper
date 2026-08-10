// Package version is the single source of truth for the application version.
//
// The source of truth is the git tag, not this file (#208). A release is one
// action — push a vX.Y.Z tag — and the build stamps that tag into the binary:
//
//	go build -ldflags "-X github.com/goncalo1021pt/questboard/backend/internal/version.Current=1.7.0"
//
// The Makefile and backend/Dockerfile do that from `git describe`, so a build
// off a tag reports the tag and a build off main reports how far past it is
// (1.7.0-12-gabc1234). Nothing is committed when cutting a release, which is
// what stops the tag and the version from ever disagreeing.
//
// Left unstamped — `go run ./cmd/server` while developing, or a build that
// forgot the flag — it reads 0.0.0-dev on purpose. A wrong version should look
// wrong rather than quietly claim to be last year's release.
package version

// Current is the running application version, surfaced via /api/auth/config.
// Set at build time; see the package comment.
var Current = "0.0.0-dev"
