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
			serveFile(w, r, reqPath)
			return
		}

		// SPA fallback: any unknown route renders the app shell.
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
