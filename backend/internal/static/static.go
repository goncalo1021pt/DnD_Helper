// Package static serves the embedded single-page app. The real build output
// (frontend/dist) is copied into this directory before `go build`; the
// placeholder index.html keeps the embed valid during backend-only development.
package static

import (
	"bytes"
	"embed"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed all:assets index.html
var files embed.FS

// Handler returns an http.Handler that serves embedded static assets and falls
// back to index.html for unknown paths (client-side routing).
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if reqPath == "" {
			reqPath = "index.html"
		}

		if f, err := files.Open(reqPath); err == nil {
			f.Close()
			if strings.HasPrefix(reqPath, "assets/") {
				// Asset filenames carry a content hash; cache them forever.
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				// index.html must revalidate so a new deploy is picked up.
				w.Header().Set("Cache-Control", "no-cache")
			}
			serveFile(w, r, reqPath)
			return
		}

		// A missing asset (e.g. a stale index.html requesting an old bundle) is
		// a real 404 — the SPA fallback would serve it HTML masquerading as JS.
		if strings.HasPrefix(reqPath, "assets/") {
			http.NotFound(w, r)
			return
		}

		// SPA fallback: any unknown route renders the app shell.
		w.Header().Set("Cache-Control", "no-cache")
		serveFile(w, r, "index.html")
	})
}

func serveFile(w http.ResponseWriter, r *http.Request, name string) {
	data, err := files.ReadFile(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
