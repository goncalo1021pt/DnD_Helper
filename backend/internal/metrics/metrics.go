// Package metrics instruments the Quest Board server for Prometheus.
//
// Everything the app exports lives on a single private registry (not the global
// default one) so we control exactly what appears on /metrics: HTTP traffic,
// database-pool health, Go runtime + process stats, and a handful of
// game-flavoured counters (quests claimed, encounters run, …).
//
// The /metrics endpoint is served on its OWN listener (see cmd/server), never
// on the public :8080, so it is only reachable over the LAN/VPN and can never
// leak through the Cloudflare tunnel.
package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// namespace prefixes every metric this app defines, so in Grafana you can find
// them all by typing `questboard_`.
const namespace = "questboard"

// Registry is the single registry all app metrics register onto. It is exposed
// so main() can register the DB-pool collector once the pool exists.
var Registry = prometheus.NewRegistry()

var (
	// httpRequestsTotal counts finished HTTP requests, split by method, the
	// matched chi route pattern (NOT the raw path — that would explode
	// cardinality), and the response status class.
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "http",
			Name:      "requests_total",
			Help:      "Total HTTP requests processed, by method, route pattern and status code.",
		},
		[]string{"method", "route", "status"},
	)

	// httpRequestDuration is a latency histogram per method+route. The default
	// buckets span 5ms–10s, which comfortably covers this app's handlers.
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "http",
			Name:      "request_duration_seconds",
			Help:      "HTTP request latency in seconds, by method and route pattern.",
			Buckets:   prometheus.DefBuckets,
		},
		[]string{"method", "route"},
	)

	// httpRequestsInFlight tracks how many requests are being served right now.
	httpRequestsInFlight = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "http",
			Name:      "requests_in_flight",
			Help:      "Number of HTTP requests currently being served.",
		},
	)

	// gameEvents counts domain-level happenings worth watching on a dashboard.
	// One counter with an "event" label keeps things tidy; increment it via the
	// typed helpers below (QuestClaimed, EncounterRun, …).
	gameEvents = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "game",
			Name:      "events_total",
			Help:      "Domain events, by type (quest_created, quest_claimed, campaign_created, hero_forged, encounter_run).",
		},
		[]string{"event"},
	)
)

func init() {
	// Runtime + process stats (goroutines, GC, heap, open FDs, CPU, …) — the
	// standard collectors every Go service should export.
	Registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		httpRequestsTotal,
		httpRequestDuration,
		httpRequestsInFlight,
		gameEvents,
	)
}

// Handler serves the metrics registry in the Prometheus text exposition format.
func Handler() http.Handler {
	return promhttp.HandlerFor(Registry, promhttp.HandlerOpts{Registry: Registry})
}

// Middleware records request count, latency and in-flight gauge for every
// request. Mount it at the router root so it sees the final matched route
// pattern via chi's RouteContext after the handler runs.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpRequestsInFlight.Inc()
		defer httpRequestsInFlight.Dec()

		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(ww, r)

		route := routePattern(r)
		httpRequestsTotal.WithLabelValues(r.Method, route, strconv.Itoa(ww.Status())).Inc()
		httpRequestDuration.WithLabelValues(r.Method, route).Observe(time.Since(start).Seconds())
	})
}

// routePattern returns the chi route template (e.g. "/api/campaigns/{id}") so
// distinct IDs collapse into one series. Unmatched requests bucket under
// "other" to keep cardinality bounded.
func routePattern(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" {
			return p
		}
	}
	return "other"
}

// Game-event helpers. Handlers call these at the point the thing actually
// happened (after the write succeeds), so a counter only moves on real events.
func QuestCreated()    { gameEvents.WithLabelValues("quest_created").Inc() }
func QuestClaimed()    { gameEvents.WithLabelValues("quest_claimed").Inc() }
func CampaignCreated() { gameEvents.WithLabelValues("campaign_created").Inc() }
func HeroForged()      { gameEvents.WithLabelValues("hero_forged").Inc() }
func EncounterRun()    { gameEvents.WithLabelValues("encounter_run").Inc() }
