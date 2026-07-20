package auth

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// rateLimiter is a small fixed-window limiter keyed by client IP that counts
// only FAILED auth attempts. Successful logins and registrations never consume
// budget, so honest users — including a whole table of players registering from
// one shared IP at game night — are unaffected; only repeated wrong guesses
// (brute force, username probing) accrue and eventually get blocked. In-memory
// is sufficient for a single-container app; a restart forgives everyone.
type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string]*window
	limit  int
	window time.Duration
}

type window struct {
	count int
	reset time.Time
}

func newRateLimiter(limit int, per time.Duration) *rateLimiter {
	return &rateLimiter{hits: make(map[string]*window), limit: limit, window: per}
}

// blocked reports whether key has already exhausted its failure budget for the
// current window. It does not record anything.
func (rl *rateLimiter) blocked(key string, now time.Time) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	w, ok := rl.hits[key]
	if !ok || now.After(w.reset) {
		return false
	}
	return w.count >= rl.limit
}

// record charges one failure against key, opening a fresh window if needed.
func (rl *rateLimiter) record(key string, now time.Time) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	w, ok := rl.hits[key]
	if !ok || now.After(w.reset) {
		rl.hits[key] = &window{count: 1, reset: now.Add(rl.window)}
		rl.sweep(now)
		return
	}
	w.count++
}

// sweep drops expired windows so the map can't grow without bound. Called
// opportunistically under the held lock when a fresh window is created.
func (rl *rateLimiter) sweep(now time.Time) {
	if len(rl.hits) < 1024 {
		return
	}
	for k, w := range rl.hits {
		if now.After(w.reset) {
			delete(rl.hits, k)
		}
	}
}

// clientIP extracts the caller's IP for rate-limit keying. Behind the
// Cloudflare tunnel the RealIP middleware has already set RemoteAddr from the
// forwarded header, so this trusts RemoteAddr.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
