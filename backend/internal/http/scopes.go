package http

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
)

// scopeGate stands in front of every operation and compares what the operation
// declares (`security: bearerToken: [campaigns:run]` in the spec — the
// generated wrapper puts it on the context before the per-route middlewares
// run) with what the caller's grant holds (#313).
//
// It never decides *who* the caller is to a row — the handler's own guard
// still does that. It decides only whether this door is open to this kind of
// caller at all:
//
//   - an operation declaring no security at all (`/health`) is public;
//   - a request with no identity passes through, and the handler answers 401
//     as it always has;
//   - a session holds every scope, including the session-only operations
//     (those declaring `sessionCookie` alone);
//   - a token must hold each declared scope, and is refused with 403 —
//     saying which scope it lacks — otherwise. A token at a session-only
//     door is refused whatever it holds.
//   - an identity with no grant is refused: every door sets one, and a new
//     door that forgets fails closed rather than acting as the whole person.
func scopeGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		bearer, viaToken := ctx.Value(api.BearerTokenScopes).([]string)
		_, viaSession := ctx.Value(api.SessionCookieScopes).([]string)
		if !viaToken && !viaSession {
			next.ServeHTTP(w, r) // public
			return
		}
		if _, signedIn := auth.UserID(ctx); !signedIn {
			next.ServeHTTP(w, r) // the handler's 401
			return
		}
		grant, ok := auth.GrantOf(ctx)
		if !ok {
			refuseScope(w, "this door hands out no grant")
			return
		}
		if grant.Kind == auth.GrantSession {
			next.ServeHTTP(w, r)
			return
		}
		if !viaToken {
			refuseScope(w, "this operation is only available from a signed-in session")
			return
		}
		for _, raw := range bearer {
			need, known := auth.ParseScope(raw)
			if !known || !grant.Holds(need) {
				refuseScope(w, "this token does not hold "+raw)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func refuseScope(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(api.Error{Error: msg})
}

// withScope declares a scope for a route the generator never saw — the image
// and stream routes hand-mounted in router.go — and gates it exactly as a
// generated operation is gated.
func withScope(scope auth.Scope) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		gated := scopeGate(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), api.SessionCookieScopes, []string{})
			ctx = context.WithValue(ctx, api.BearerTokenScopes, []string{string(scope)})
			gated.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
