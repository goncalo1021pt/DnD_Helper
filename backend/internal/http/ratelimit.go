package http

import (
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

// RateLimits are the ceilings (#314): each a sustained number of requests per
// minute, with a burst of twice that allowed before it bites. 0 turns a
// ceiling off. They come from RATE_LIMIT_*_PER_MINUTE in the environment, so
// the numbers are tuned on the box rather than guessed here.
type RateLimits struct {
	Token   int // per API token — a script, the tightest
	IP      int // per client IP, for bearer and anonymous requests; never a session
	Session int // per signed-in person; generous, a browser bursts on page load
}

// routeCost is what a request draws from its buckets, by chi route pattern —
// the same pattern the metrics are labelled with, looked up as "METHOD pattern"
// first and then as the pattern alone. Everything absent costs 1. The heavy
// doors here are the ones a loop with a bug would hammer: the codex lists
// (the Den is a quarter-megabyte), a map image, a pack in or out, a map upload.
var routeCost = map[string]float64{
	"/api/rules/{kind}":                     5,
	"/api/rules/export":                     10,
	"/api/rules/import":                     10,
	"/api/maps/{mapID}/image":               5,
	"POST /api/campaigns/{campaignId}/maps": 10,
	"/api/me/export":                        25, // everything you own, in one read (#317)
	"/api/openapi.json":                     5,  // the contract, a few hundred KB (#348)
	"/api/openapi.yaml":                     5,
}

// costOf reads the matched route off the request. It runs inside the endpoint
// (a With middleware, or the generator's wrapper), where chi has already
// settled the pattern.
func costOf(r *http.Request) float64 {
	pattern := ""
	if rc := chi.RouteContext(r.Context()); rc != nil {
		pattern = rc.RoutePattern()
	}
	if c, ok := routeCost[r.Method+" "+pattern]; ok {
		return c
	}
	if c, ok := routeCost[pattern]; ok {
		return c
	}
	return 1
}

// ceiling is one bucket a request draws from.
type ceiling struct {
	key    string
	kind   string // the metric label: token | ip | session
	perMin int
}

func (c ceiling) rate() float64  { return float64(c.perMin) / 60 } // per second
func (c ceiling) burst() float64 { return float64(2 * c.perMin) }

// bucket is a token bucket: level is what is left to spend, brought up to date
// lazily from seen whenever it is read. In-memory is enough for one container;
// a restart forgives everyone, as the login limiter's does.
type bucket struct {
	level float64
	seen  time.Time
}

type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	limits  RateLimits
	now     func() time.Time
}

func newLimiter(l RateLimits) *limiter {
	return &limiter{buckets: map[string]*bucket{}, limits: l, now: time.Now}
}

// ceilingsFor decides which buckets a request draws from. A token draws from
// its own and from its IP's, so many keys on one host still share a ceiling; a
// session draws from the person's alone — a whole table on one Wi-Fi must
// never share one, which is the login limiter's reasoning too; anybody else
// (a public door, a stranger) draws from the IP's.
func (l *limiter) ceilingsFor(r *http.Request) []ceiling {
	ctx := r.Context()
	g, _ := auth.GrantOf(ctx)
	switch g.Kind {
	case auth.GrantToken:
		return []ceiling{
			{"token:" + g.TokenID.String(), "token", l.limits.Token},
			{"ip:" + remoteIP(r), "ip", l.limits.IP},
		}
	case auth.GrantSession:
		if uid, ok := auth.UserID(ctx); ok {
			return []ceiling{{"user:" + uid.String(), "session", l.limits.Session}}
		}
	}
	return []ceiling{{"ip:" + remoteIP(r), "ip", l.limits.IP}}
}

// take draws cost from every ceiling at once, or from none: the first that
// cannot afford it is returned, with how long until it could.
func (l *limiter) take(cs []ceiling, cost float64) (refused *ceiling, wait time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	bs := make([]*bucket, len(cs))
	for i, c := range cs {
		if c.perMin <= 0 {
			continue
		}
		b := l.bucket(c, now)
		if b.level < cost {
			c := c
			return &c, time.Duration((cost - b.level) / c.rate() * float64(time.Second))
		}
		bs[i] = b
	}
	for _, b := range bs {
		if b != nil {
			b.level -= cost
		}
	}
	return nil, 0
}

// bucket brings a ceiling's bucket up to date, making a full one on first sight.
func (l *limiter) bucket(c ceiling, now time.Time) *bucket {
	b, ok := l.buckets[c.key]
	if !ok {
		l.sweep(now)
		b = &bucket{level: c.burst(), seen: now}
		l.buckets[c.key] = b
		return b
	}
	b.level = math.Min(c.burst(), b.level+now.Sub(b.seen).Seconds()*c.rate())
	b.seen = now
	return b
}

// sweep drops buckets nobody has drawn from in ten minutes — long since full
// again at any rate worth setting — so the map cannot grow without bound.
// Called under the held lock when a new bucket is made, once the map is large.
func (l *limiter) sweep(now time.Time) {
	if len(l.buckets) < 4096 {
		return
	}
	for k, b := range l.buckets {
		if now.Sub(b.seen) > 10*time.Minute {
			delete(l.buckets, k)
		}
	}
}

// remoteIP is the caller for keying. Behind the tunnel the RealIP middleware
// has already put the forwarded address in RemoteAddr.
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimit stands in front of every door in the API group (#314). A request
// its ceilings cannot afford is answered 429 with Retry-After in whole seconds
// and the error body the SPA's notice layer already reads; a token refused
// this way is marked on its row, so the profile can say the script is looping.
func (s *Server) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.limiter == nil {
			next.ServeHTTP(w, r)
			return
		}
		refused, wait := s.limiter.take(s.limiter.ceilingsFor(r), costOf(r))
		if refused == nil {
			next.ServeHTTP(w, r)
			return
		}
		metrics.RateLimited(refused.kind)
		if g, ok := auth.GrantOf(r.Context()); ok && g.Kind == auth.GrantToken && s.queries != nil {
			// Best effort, throttled in SQL to one write a minute per token.
			_ = s.queries.ThrottleAPIToken(r.Context(), g.TokenID)
		}
		secs := int(math.Ceil(wait.Seconds()))
		if secs < 1 {
			secs = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(api.Error{Error: fmt.Sprintf("too many requests — try again in %ds", secs)})
	})
}
