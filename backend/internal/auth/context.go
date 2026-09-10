package auth

import (
	"context"
	"net/http"

	"github.com/alexedwards/scs/v2"
	"github.com/google/uuid"
)

const sessionUserKey = "user_id"

type ctxKey int

const (
	userIDCtxKey ctxKey = iota
	grantCtxKey
)

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

// GrantKind says which door the caller came through.
type GrantKind int

const (
	// GrantSession is a browser with a session cookie: the whole person, every
	// scope, and the only kind that may reach session-only operations (token
	// management, the homebrew reset).
	GrantSession GrantKind = iota + 1
	// GrantToken is an API token (#294): the scopes it was minted with, and
	// perhaps one campaign.
	GrantToken
)

// Grant is what the caller is allowed to touch — set beside the user id by
// whichever door authenticated the request, and read by the scope gate in
// front of every operation. A request that carries a user id and no grant is
// refused: the doors are known, and a new one must say what it hands out.
type Grant struct {
	Kind   GrantKind
	Scopes Scopes // what a token holds; a session holds everything and this is ignored
	// Campaign is the one table a token may reach, when it was minted for one
	// (#294); nil means every table the person sits at. The scope gate does not
	// read it — the campaign guards do, once they know the table a row belongs
	// to — but it travels with the grant because it was decided at the same door.
	Campaign *uuid.UUID
}

// Holds reports whether this grant satisfies a door asking for need.
func (g Grant) Holds(need Scope) bool {
	return g.Kind == GrantSession || g.Scopes.Holds(need)
}

// WithUser records the authenticated user on the context. Every door calls it
// (the session loader below; the token loader in #294) — handlers read it back
// through UserID.
func WithUser(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, userIDCtxKey, id)
}

// WithGrant records what the door handed the caller.
func WithGrant(ctx context.Context, g Grant) context.Context {
	return context.WithValue(ctx, grantCtxKey, g)
}

// GrantOf returns the caller's grant and whether one is present.
func GrantOf(ctx context.Context) (Grant, bool) {
	g, ok := ctx.Value(grantCtxKey).(Grant)
	return g, ok
}

// Loader is middleware that reads the user id from the session into the request
// context (if present), with a session grant beside it. It does not reject
// unauthenticated requests.
func Loader(sm *scs.SessionManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if raw := sm.GetString(r.Context(), sessionUserKey); raw != "" {
				if id, err := uuid.Parse(raw); err == nil {
					ctx := WithUser(r.Context(), id)
					ctx = WithGrant(ctx, Grant{Kind: GrantSession})
					r = r.WithContext(ctx)
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
