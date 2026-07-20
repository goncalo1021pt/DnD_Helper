package auth

import (
	"context"
	"net/http"

	"github.com/alexedwards/scs/v2"
	"github.com/google/uuid"
)

const sessionUserKey = "user_id"

type ctxKey int

const userIDCtxKey ctxKey = 0

// Login records the authenticated user id in the session. It first rotates the
// session token so a pre-login session id (which an attacker may have planted)
// can never be reused as an authenticated one — the standard defense against
// session fixation. Call after any successful authentication (OAuth, dev, local).
func Login(ctx context.Context, sm *scs.SessionManager, userID uuid.UUID) error {
	if err := sm.RenewToken(ctx); err != nil {
		return err
	}
	sm.Put(ctx, sessionUserKey, userID.String())
	return nil
}

// Logout clears the session.
func Logout(ctx context.Context, sm *scs.SessionManager) error {
	return sm.Destroy(ctx)
}

// Loader is middleware that reads the user id from the session into the request
// context (if present). It does not reject unauthenticated requests.
func Loader(sm *scs.SessionManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if raw := sm.GetString(r.Context(), sessionUserKey); raw != "" {
				if id, err := uuid.Parse(raw); err == nil {
					r = r.WithContext(context.WithValue(r.Context(), userIDCtxKey, id))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserID returns the authenticated user id and whether one is present.
func UserID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(userIDCtxKey).(uuid.UUID)
	return id, ok
}
