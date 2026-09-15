package auth

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// BearerLoader is the token door (#294), mounted after the session Loader and
// only on the API routes — never on /api/auth/*, so a token holds no identity
// at the sign-in, password and 2FA doors.
//
// If the Authorization header is present it decides the identity: a live token
// becomes its owner with a GrantToken carrying the scopes it was minted with
// and, when it was minted for one, the one table it may reach. An invalid,
// revoked or expired token is refused with 401 on the spot — never a silent
// fall-back to whatever cookie rode along, because a script with a bad token
// must learn so, not act as somebody's browser.
func BearerLoader(q *db.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				next.ServeHTTP(w, r)
				return
			}
			scheme, raw, found := strings.Cut(header, " ")
			raw = strings.TrimSpace(raw)
			if !found || !strings.EqualFold(scheme, "Bearer") || !strings.HasPrefix(raw, TokenPrefix) {
				refuseBearer(w)
				return
			}
			row, err := q.GetLiveAPITokenByHash(r.Context(), HashAPIToken(raw))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					refuseBearer(w)
					return
				}
				http.Error(w, "token lookup failed", http.StatusInternalServerError)
				return
			}
			// Best effort, throttled in SQL to one write a minute per token.
			_ = q.TouchAPIToken(r.Context(), row.ID)

			grant := Grant{Kind: GrantToken, TokenID: row.ID}
			for _, s := range row.Scopes {
				if sc, ok := ParseScope(s); ok {
					grant.Scopes = append(grant.Scopes, sc)
				}
			}
			if row.CampaignID.Valid {
				id := uuid.UUID(row.CampaignID.Bytes)
				grant.Campaign = &id
			}
			ctx := WithUser(r.Context(), row.UserID)
			ctx = WithGrant(ctx, grant)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func refuseBearer(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="questboard"`)
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired token"})
}
