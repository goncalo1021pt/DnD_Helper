package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/auth"
)

// A clock the tests turn by hand.
func clocked(l RateLimits) (*limiter, *time.Time) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	lim := newLimiter(l)
	lim.now = func() time.Time { return now }
	return lim, &now
}

func TestBucketBurstsThenRefusesThenRefills(t *testing.T) {
	lim, now := clocked(RateLimits{Token: 60}) // 1/s, burst 120
	cs := []ceiling{{"token:x", "token", 60}}

	// The codex costs 5: twenty-four shelves on a fresh token, then no more.
	for i := 0; i < 24; i++ {
		if refused, _ := lim.take(cs, 5); refused != nil {
			t.Fatalf("request %d should pass on a fresh bucket", i+1)
		}
	}
	refused, wait := lim.take(cs, 5)
	if refused == nil || refused.kind != "token" {
		t.Fatalf("the 25th shelf should be refused by the token ceiling, got %v", refused)
	}
	if wait != 5*time.Second {
		t.Fatalf("an empty bucket at 1/s affords 5 in 5s, got %v", wait)
	}
	// A cheap door is also refused while the bucket is empty…
	if refused, _ := lim.take(cs, 1); refused == nil {
		t.Fatal("an empty bucket affords nothing")
	}
	// …and opens again as it refills.
	*now = now.Add(2 * time.Second)
	if refused, _ := lim.take(cs, 1); refused != nil {
		t.Fatal("two seconds buys two cheap requests")
	}
	if refused, wait := lim.take(cs, 5); refused == nil || wait != 4*time.Second {
		t.Fatalf("one credit left: 5 needs 4 more seconds, got %v %v", refused, wait)
	}
	*now = now.Add(time.Hour)
	if refused, _ := lim.take(cs, 120); refused != nil {
		t.Fatal("an hour later the bucket is full again, and never fuller than the burst")
	}
	if refused, _ := lim.take(cs, 1); refused == nil {
		t.Fatal("the burst is the cap")
	}
}

func TestTakeIsAllOrNothing(t *testing.T) {
	lim, _ := clocked(RateLimits{Token: 1, IP: 300}) // token burst 2, ip burst 600
	// The generous ceiling is read first, so its bucket exists and could
	// have been charged before the tiny one said no.
	cs := []ceiling{{"ip:1.2.3.4", "ip", 300}, {"token:x", "token", 1}}
	refused, _ := lim.take(cs, 5)
	if refused == nil || refused.kind != "token" {
		t.Fatalf("the tiny ceiling refuses, got %v", refused)
	}
	// The other bucket was not charged for a request that never happened.
	if b := lim.buckets["ip:1.2.3.4"]; b == nil || b.level != 600 {
		t.Fatalf("the ip bucket should be untouched, got %+v", b)
	}
	// And a request both can afford charges both.
	if refused, _ := lim.take(cs, 2); refused != nil {
		t.Fatal("2 fits the tiny burst")
	}
	if lim.buckets["ip:1.2.3.4"].level != 598 || lim.buckets["token:x"].level != 0 {
		t.Fatalf("both charged: ip %v token %v", lim.buckets["ip:1.2.3.4"].level, lim.buckets["token:x"].level)
	}
}

func TestCeilingOffWhenZero(t *testing.T) {
	lim, _ := clocked(RateLimits{})
	cs := []ceiling{{"token:x", "token", 0}, {"ip:1.2.3.4", "ip", 0}}
	for i := 0; i < 10_000; i++ {
		if refused, _ := lim.take(cs, 10); refused != nil {
			t.Fatal("0 means no ceiling")
		}
	}
}

func TestCeilingsFor(t *testing.T) {
	lim, _ := clocked(RateLimits{Token: 60, IP: 300, Session: 600})
	tokenID, userID := uuid.New(), uuid.New()
	req := func(ctx context.Context) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/api/me", nil).WithContext(ctx)
		r.RemoteAddr = "203.0.113.9:4242"
		return r
	}
	kinds := func(cs []ceiling) []string {
		out := []string{}
		for _, c := range cs {
			out = append(out, c.kind+"="+c.key)
		}
		return out
	}

	token := auth.WithGrant(auth.WithUser(context.Background(), userID), auth.Grant{Kind: auth.GrantToken, TokenID: tokenID})
	if got := kinds(lim.ceilingsFor(req(token))); len(got) != 2 || got[0] != "token=token:"+tokenID.String() || got[1] != "ip=ip:203.0.113.9" {
		t.Fatalf("a token draws from its own bucket and its IP's, got %v", got)
	}
	session := auth.WithGrant(auth.WithUser(context.Background(), userID), auth.Grant{Kind: auth.GrantSession})
	if got := kinds(lim.ceilingsFor(req(session))); len(got) != 1 || got[0] != "session=user:"+userID.String() {
		t.Fatalf("a session draws from the person's bucket alone, got %v", got)
	}
	if got := kinds(lim.ceilingsFor(req(context.Background()))); len(got) != 1 || got[0] != "ip=ip:203.0.113.9" {
		t.Fatalf("a stranger draws from the IP's, got %v", got)
	}
}

// The cost is read off the route pattern chi settled, from inside the
// endpoint — mounted the way router.go mounts it.
func TestCostOfSeesTheRoutePattern(t *testing.T) {
	var seen []float64
	capture := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seen = append(seen, costOf(r))
			next.ServeHTTP(w, r)
		})
	}
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }

	r := chi.NewRouter()
	r.Route("/api", func(ar chi.Router) {
		ar.Group(func(g chi.Router) {
			g.With(capture).Get("/rules/{kind}", ok)
			g.With(capture).Get("/maps/{mapID}/image", ok)
			g.With(capture).Get("/campaigns/{campaignId}/maps", ok)
			g.With(capture).Post("/campaigns/{campaignId}/maps", ok)
			g.With(capture).Get("/me", ok)
		})
	})
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/rules/monster"},
		{http.MethodGet, "/api/maps/abc/image"},
		{http.MethodGet, "/api/campaigns/abc/maps"},
		{http.MethodPost, "/api/campaigns/abc/maps"},
		{http.MethodGet, "/api/me"},
	} {
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(c.method, c.path, nil))
	}
	want := []float64{5, 5, 1, 10, 1}
	if len(seen) != len(want) {
		t.Fatalf("saw %v", seen)
	}
	for i := range want {
		if seen[i] != want[i] {
			t.Fatalf("costs %v, want %v", seen, want)
		}
	}
}

func TestRateLimitMiddleware(t *testing.T) {
	lim, _ := clocked(RateLimits{IP: 1}) // burst 2 for a stranger
	s := &Server{limiter: lim}
	h := s.rateLimit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) }))
	call := func(ctx context.Context) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/health", nil).WithContext(ctx)
		r.RemoteAddr = "198.51.100.7:1"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	for i := 0; i < 2; i++ {
		if rec := call(context.Background()); rec.Code != http.StatusTeapot {
			t.Fatalf("request %d: %d", i+1, rec.Code)
		}
	}
	rec := call(context.Background())
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("the third should be refused, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "60" {
		t.Fatalf("at 1 a minute an empty bucket affords 1 in 60s, Retry-After %q", got)
	}
	var body struct{ Error string }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error == "" {
		t.Fatalf("the refusal carries the error body the notice layer reads, got %q", rec.Body.String())
	}

	// A session with its ceiling off is never refused, and never shares the IP's.
	session := auth.WithGrant(auth.WithUser(context.Background(), uuid.New()), auth.Grant{Kind: auth.GrantSession})
	for i := 0; i < 100; i++ {
		if rec := call(session); rec.Code != http.StatusTeapot {
			t.Fatalf("a session behind the same IP is not the stranger, got %d", rec.Code)
		}
	}

	// No limiter at all (tests that build a bare Server) passes everything.
	bare := &Server{}
	rec = httptest.NewRecorder()
	bare.rateLimit(h).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code == http.StatusInternalServerError {
		t.Fatal("a nil limiter must be a no-op")
	}
}
