package static

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The favicon lives in frontend/public, so Vite emits it to the dist ROOT while
// the bundles go to dist/assets. When it was missing from the embed it did NOT
// 404 — the SPA fallback answered with index.html, so the browser asked for an
// icon and got a webpage, and the tab just looked blank. Assert on the served
// content type: a 200 alone would have passed while the bug was live.
func TestFaviconIsServedAsSVG(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/favicon.svg", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /favicon.svg = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "image/svg+xml") {
		t.Errorf("Content-Type = %q, want image/svg+xml — the SPA fallback is answering for it", ct)
	}
	if body := rec.Body.String(); !strings.Contains(body, "<svg") {
		t.Errorf("body is not an SVG (first 80 bytes: %.80q)", body)
	}
}

// The fallback itself must keep working — an unknown path is a client-side
// route, not a 404.
func TestUnknownRouteFallsBackToIndex(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/campaigns/42/board", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /campaigns/42/board = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
}

// A missing bundle must 404 rather than fall back, or the browser gets HTML
// with a .js content type and fails in a far more confusing way.
func TestMissingAssetIs404(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/stale-bundle.js", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /assets/stale-bundle.js = %d, want 404", rec.Code)
	}
}
