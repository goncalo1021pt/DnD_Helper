package metrics

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// TestHandlerExposesGameCounter drives a game-event helper and asserts it shows
// up in the /metrics exposition.
func TestHandlerExposesGameCounter(t *testing.T) {
	QuestClaimed()

	rr := httptest.NewRecorder()
	Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	body, _ := io.ReadAll(rr.Result().Body)
	if !strings.Contains(string(body), `questboard_game_events_total{event="quest_claimed"}`) {
		t.Fatalf("expected quest_claimed counter in /metrics output, got:\n%s", body)
	}
}

// TestMiddlewareRecordsRoutePattern checks that requests are labelled by the
// chi route template, not the concrete path — the whole point of routePattern.
func TestMiddlewareRecordsRoutePattern(t *testing.T) {
	r := chi.NewRouter()
	r.Use(Middleware)
	r.Get("/api/campaigns/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/campaigns/abc-123", nil))

	rr2 := httptest.NewRecorder()
	Handler().ServeHTTP(rr2, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body, _ := io.ReadAll(rr2.Result().Body)

	want := `questboard_http_requests_total{method="GET",route="/api/campaigns/{id}",status="204"}`
	if !strings.Contains(string(body), want) {
		t.Fatalf("expected templated route label in output, got:\n%s", body)
	}
}

// TestDBPoolCollectorDescribes ensures every pool descriptor is advertised.
// (Collect is exercised for real against a live pool by the integration path;
// a zero-value pgxpool.Stat can't be constructed without one.)
func TestDBPoolCollectorDescribes(t *testing.T) {
	c := newDBPoolCollector((*pgxpool.Pool)(nil))

	descs := make(chan *prometheus.Desc, 32)
	c.Describe(descs)
	close(descs)

	const want = 9 // keep in sync with the descriptors in newDBPoolCollector
	if got := len(descs); got != want {
		t.Fatalf("collector described %d metrics, want %d", got, want)
	}
}
