package http

import (
	"net/http"

	"github.com/alexedwards/scs/v2"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
	"github.com/goncalo1021pt/questboard/backend/internal/static"
)

// Deps holds the dependencies the HTTP layer needs.
type Deps struct {
	Pool           *pgxpool.Pool
	SessionManager *scs.SessionManager
	OAuth          *auth.OAuth
	Mailer         mail.Mailer // the created-token tripwire (#294); nil sends nothing
	BaseURL        string      // where that email's link points
	RateLimits     RateLimits  // the ceilings (#314); all zero = none
	Events         *events.Bus // the catalogue (#315); nil emits into silence
}

// NewRouter builds the application router: API routes under /api (session-aware)
// and the embedded single-page app for everything else.
func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(metrics.Middleware)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(enforceTLS)

	srv := NewServer(deps.Pool)
	srv.mailer, srv.baseURL = deps.Mailer, deps.BaseURL
	srv.limiter = newLimiter(deps.RateLimits)
	srv.events = deps.Events
	strict := api.NewStrictHandler(srv, nil)

	r.Route("/api", func(ar chi.Router) {
		// Session cookie load/save + populate the user id into the request context.
		ar.Use(deps.SessionManager.LoadAndSave)
		ar.Use(auth.Loader(deps.SessionManager))

		// Sign-in, sign-out, passwords, 2FA: the session's business alone. The
		// bearer loader is not mounted here, so a token holds no identity at
		// these doors whatever it was minted with (#294).
		ar.Route("/auth", deps.OAuth.Routes)

		ar.Group(func(g chi.Router) {
			// The token door (#294): an Authorization header decides the
			// identity, and a bad one is refused here rather than falling
			// back to the cookie.
			g.Use(auth.BearerLoader(srv.queries))

			// Map and handout images stream outside the JSON contract (binary,
			// cacheable), each re-checking its own veil before writing bytes.
			// Being outside the contract, they declare their scope here — the
			// generator never saw them (#313).
			// Every door in this group stands behind the rate limiter (#314):
			// the generated ones through mountAPI, these through With.
			g.With(srv.rateLimit, withScope(auth.CampaignsRead)).Get("/maps/{mapID}/image", srv.ServeMapImage)
			g.With(srv.rateLimit, withScope(auth.CampaignsRead)).Get("/handouts/{handoutID}/image", srv.ServeHandoutImage)

			// The live nudge stream (#109). Outside the contract for the same
			// reason: a strict handler returns a typed object and is done, and a
			// stream is the opposite of done.
			g.With(srv.rateLimit, withScope(auth.CampaignsRead)).Get("/campaigns/{campaignID}/events/stream", srv.ServeCampaignStream)
			// The account's own stream: friendship and direct messages belong to a
			// person rather than to a table, so they travel in a room of their own.
			g.With(srv.rateLimit, withScope(auth.AccountRead)).Get("/me/events/stream", srv.ServeMeStream)

			// Register the generated, type-checked operation handlers onto this
			// subrouter (paths: /health, /me, /campaigns).
			mountAPI(g, strict, srv.rateLimit)
		})
	})

	// Static SPA + client-side routing fallback.
	r.Handle("/*", static.Handler())

	return r
}

// mountAPI registers the generated handlers onto an existing chi router, with
// the scope gate in front of every one of them (#313) and the rate limiter in
// front of that (#314). The generator wraps in slice order, so the last entry
// is the outermost: a refused request is counted before its scope is read.
func mountAPI(r chi.Router, si api.ServerInterface, limit func(http.Handler) http.Handler) {
	api.HandlerWithOptions(si, api.ChiServerOptions{
		BaseRouter:  r,
		Middlewares: []api.MiddlewareFunc{scopeGate, limit},
	})
}
