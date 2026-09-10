package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
)

// Every operation says which scope opens it. The bundled spec is the one place
// that says so, and this walk is what makes "a new endpoint cannot forget" true:
// an operation with no `security` of its own would fall to the global default
// (session-only) and pass every test that does not look — so this one looks.
func TestEveryOperationDeclaresItsScope(t *testing.T) {
	doc, err := api.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	sessionOnly := map[string]bool{}
	public := map[string]bool{}
	total := 0
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			total++
			key := method + " " + path
			if op.Security == nil {
				t.Errorf("%s declares no security of its own — say sessionCookie alone, bearerToken with one scope, or [] for public", key)
				continue
			}
			reqs := *op.Security
			if len(reqs) == 0 {
				public[key] = true
				continue
			}
			viaToken := false
			for _, req := range reqs {
				for scheme, scopes := range req {
					switch scheme {
					case "sessionCookie":
						if len(scopes) != 0 {
							t.Errorf("%s: sessionCookie carries no scopes", key)
						}
					case "bearerToken":
						viaToken = true
						if len(scopes) != 1 {
							t.Errorf("%s: bearerToken declares exactly one scope, got %v", key, scopes)
							continue
						}
						sc, ok := auth.ParseScope(scopes[0])
						if !ok {
							t.Errorf("%s: %q is not in the vocabulary", key, scopes[0])
						}
						if strings.HasSuffix(string(sc), ":read") && method != http.MethodGet {
							t.Errorf("%s: a read scope only ever sits on a GET", key)
						}
						if method == http.MethodGet && !strings.HasSuffix(string(sc), ":read") {
							t.Errorf("%s: a GET is a read and declares a read scope, got %s", key, sc)
						}
					default:
						t.Errorf("%s: unknown security scheme %q", key, scheme)
					}
				}
			}
			if !viaToken {
				sessionOnly[key] = true
			}
		}
	}
	if total != 185 {
		t.Errorf("walked %d operations; if you added one, update this count so the walk is known to be complete", total)
	}
	if !public["GET /health"] || len(public) != 1 {
		t.Errorf("only /health is public, got %v", public)
	}
	// The homebrew reset deletes everything a person authored in one call; a
	// leaked token must not be able to. Token management (#294) joins this set.
	if !sessionOnly["DELETE /rules/homebrew"] || len(sessionOnly) != 1 {
		t.Errorf("session-only operations should be exactly the homebrew reset, got %v", sessionOnly)
	}
}

// The gate in front of an operation, driven directly: what the wrapper puts on
// the context (the declared scopes) against what the door put there (the grant).
func TestScopeGate(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	uid := uuid.New()
	type tc struct {
		name     string
		declared []string // nil = public; empty = session-only
		user     bool
		grant    *auth.Grant
		want     int
		lacks    string
	}
	token := func(s ...auth.Scope) *auth.Grant { return &auth.Grant{Kind: auth.GrantToken, Scopes: s} }
	session := &auth.Grant{Kind: auth.GrantSession}
	cases := []tc{
		{"public, anonymous", nil, false, nil, http.StatusTeapot, ""},
		{"declared, anonymous: the handler's 401, not ours", []string{"campaigns:read"}, false, nil, http.StatusTeapot, ""},
		{"session opens everything", []string{"campaigns:own"}, true, session, http.StatusTeapot, ""},
		{"session opens session-only", []string{}, true, session, http.StatusTeapot, ""},
		{"token holding the scope", []string{"campaigns:read"}, true, token(auth.CampaignsRead), http.StatusTeapot, ""},
		{"token above the rung", []string{"campaigns:run"}, true, token(auth.CampaignsOwn), http.StatusTeapot, ""},
		{"token below the rung", []string{"campaigns:run"}, true, token(auth.CampaignsPlay), http.StatusForbidden, "campaigns:run"},
		{"token in another domain", []string{"heroes:write"}, true, token(auth.CampaignsOwn), http.StatusForbidden, "heroes:write"},
		{"token at a session-only door", []string{}, true, token(auth.AllScopes...), http.StatusForbidden, "signed-in session"},
		{"identity without a grant fails closed", []string{"campaigns:read"}, true, nil, http.StatusForbidden, "no grant"},
		{"a scope outside the vocabulary is refused", []string{"campaigns:emperor"}, true, token(auth.CampaignsOwn), http.StatusForbidden, "campaigns:emperor"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx := context.Background()
			if c.declared != nil {
				ctx = context.WithValue(ctx, api.SessionCookieScopes, []string{})
				if len(c.declared) > 0 {
					ctx = context.WithValue(ctx, api.BearerTokenScopes, c.declared)
				}
			}
			if c.user {
				ctx = auth.WithUser(ctx, uid)
			}
			if c.grant != nil {
				ctx = auth.WithGrant(ctx, *c.grant)
			}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/x", nil).WithContext(ctx)
			scopeGate(ok).ServeHTTP(rec, req)
			if rec.Code != c.want {
				t.Fatalf("got %d, want %d", rec.Code, c.want)
			}
			if c.want == http.StatusForbidden {
				var body api.Error
				if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
					t.Fatalf("403 body is the Error shape: %v", err)
				}
				if !strings.Contains(body.Error, c.lacks) {
					t.Fatalf("403 should name what is missing (%q), said %q", c.lacks, body.Error)
				}
			}
		})
	}
}

// A hand-mounted route declares its scope through withScope and is gated the
// same way as a generated one.
func TestWithScope(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := withScope(auth.CampaignsRead)(ok)
	call := func(g auth.Grant) int {
		ctx := auth.WithGrant(auth.WithUser(context.Background(), uuid.New()), g)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/maps/x/image", nil).WithContext(ctx))
		return rec.Code
	}
	if got := call(auth.Grant{Kind: auth.GrantSession}); got != http.StatusTeapot {
		t.Fatalf("session: got %d", got)
	}
	if got := call(auth.Grant{Kind: auth.GrantToken, Scopes: auth.Scopes{auth.CampaignsRead}}); got != http.StatusTeapot {
		t.Fatalf("token with campaigns:read: got %d", got)
	}
	if got := call(auth.Grant{Kind: auth.GrantToken, Scopes: auth.Scopes{auth.HeroesWrite}}); got != http.StatusForbidden {
		t.Fatalf("token without campaigns:read: got %d", got)
	}
}
