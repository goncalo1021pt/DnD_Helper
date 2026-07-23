package http

import (
	"net/http"

	"github.com/alexedwards/scs/v2"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/static"
)

// Deps holds the dependencies the HTTP layer needs.
type Deps struct {
	Pool           *pgxpool.Pool
	SessionManager *scs.SessionManager
	OAuth          *auth.OAuth
}

// NewRouter builds the application router: API routes under /api (session-aware)
// and the embedded single-page app for everything else.
func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(enforceTLS)

	srv := NewServer(deps.Pool)
	strict := api.NewStrictHandler(srv, nil)

	r.Route("/api", func(ar chi.Router) {
		// Session cookie load/save + populate the user id into the request context.
		ar.Use(deps.SessionManager.LoadAndSave)
		ar.Use(auth.Loader(deps.SessionManager))

		ar.Route("/auth", deps.OAuth.Routes)

		// Map images stream outside the JSON contract (binary, cacheable).
		ar.Get("/maps/{mapID}/image", srv.ServeMapImage)

		// Register the generated, type-checked operation handlers onto this
		// subrouter (paths: /health, /me, /campaigns).
		mountAPI(ar, strict)
	})

	// Static SPA + client-side routing fallback.
	r.Handle("/*", static.Handler())

	return r
}

// mountAPI registers the generated handlers onto an existing chi router.
func mountAPI(r chi.Router, si api.ServerInterface) {
	api.HandlerFromMux(si, r)
}
