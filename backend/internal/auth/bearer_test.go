package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The parser in front of the lookup: what never reaches the database. A nil
// Queries is deliberate — reaching it would panic, which is the assertion.
func TestBearerLoaderParsing(t *testing.T) {
	reached := false
	h := BearerLoader(nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		if _, ok := UserID(r.Context()); ok {
			t.Error("no header should mean no identity from this door")
		}
		w.WriteHeader(http.StatusTeapot)
	}))

	cases := []struct {
		name, header string
		wantStatus   int
	}{
		{"no header passes through", "", http.StatusTeapot},
		{"wrong scheme", "Basic qb_abcdefgh", http.StatusUnauthorized},
		{"no scheme", "qb_abcdefgh", http.StatusUnauthorized},
		{"not one of ours", "Bearer sk_live_abcdefgh", http.StatusUnauthorized},
		{"empty bearer", "Bearer ", http.StatusUnauthorized},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			reached = false
			req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
			if c.header != "" {
				req.Header.Set("Authorization", c.header)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != c.wantStatus {
				t.Fatalf("status %d, want %d", rec.Code, c.wantStatus)
			}
			if c.wantStatus == http.StatusUnauthorized {
				if reached {
					t.Fatal("a refused token must not reach the handler")
				}
				if got := rec.Header().Get("WWW-Authenticate"); got != `Bearer realm="questboard"` {
					t.Fatalf("WWW-Authenticate %q", got)
				}
			} else if !reached {
				t.Fatal("no header should pass through to the handler")
			}
		})
	}
}
