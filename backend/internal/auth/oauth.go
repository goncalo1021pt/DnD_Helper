package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/alexedwards/scs/v2"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/discord"
	"github.com/markbates/goth/providers/google"

	"github.com/goncalo1021pt/questboard/backend/internal/config"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
	"github.com/goncalo1021pt/questboard/backend/internal/version"
)

const (
	sessionOAuthState = "oauth_state"
	sessionOAuthData  = "oauth_session"
)

// OAuth holds every auth route — the goth OAuth providers, the dev shortcut,
// and the local username/password endpoints — over our scs-backed sessions.
// We use goth providers directly (not gothic) so there is a single session
// library in play.
type OAuth struct {
	sm           *scs.SessionManager
	queries      *db.Queries
	devEnabled   bool
	localEnabled bool
	loginLimiter *rateLimiter
	// mailLimiter caps outbound email per IP (verification resends, password
	// resets) on ITS OWN budget — a patient user re-requesting their mail must
	// never spend the allowance that guards their password (#249).
	mailLimiter *rateLimiter
	mailer      mail.Mailer
	baseURL     string
	totpKey     [32]byte // derived from SESSION_KEY; encrypts TOTP secrets at rest
}

// RegisterProviders configures the enabled OAuth providers. Callback URLs are
// derived from BaseURL and must match what is registered in each provider's
// developer console.
func RegisterProviders(cfg *config.Config) {
	var providers []goth.Provider
	if cfg.Discord.Enabled() {
		providers = append(providers, discord.New(
			cfg.Discord.ClientID, cfg.Discord.ClientSecret,
			cfg.BaseURL+"/api/auth/discord/callback",
			discord.ScopeIdentify, discord.ScopeEmail,
		))
	}
	if cfg.Google.Enabled() {
		providers = append(providers, google.New(
			cfg.Google.ClientID, cfg.Google.ClientSecret,
			cfg.BaseURL+"/api/auth/google/callback",
			"email", "profile",
		))
	}
	goth.UseProviders(providers...)
}

func NewOAuth(sm *scs.SessionManager, queries *db.Queries, devEnabled, localEnabled bool, mailer mail.Mailer, baseURL, sessionKey string) *OAuth {
	return &OAuth{
		sm:           sm,
		queries:      queries,
		devEnabled:   devEnabled,
		localEnabled: localEnabled,
		// Up to 25 FAILED auth attempts per IP per 15 minutes; successes don't
		// count, so a shared-IP table of players is never locked out.
		loginLimiter: newRateLimiter(25, 15*time.Minute),
		// 5 emails per IP per 15 minutes is plenty for honest re-requests.
		mailLimiter: newRateLimiter(5, 15*time.Minute),
		mailer:      mailer,
		baseURL:     baseURL,
		totpKey:     deriveTOTPKey(sessionKey),
	}
}

// Routes mounts /auth/{provider}/login, /auth/{provider}/callback and /auth/logout.
func (o *OAuth) Routes(r chi.Router) {
	// Public: lets the login screen render the right options (which providers are
	// configured, and whether the dev-login shortcut is available). The frontend
	// is a static build, so it can't know the backend's mode without asking.
	r.Get("/config", o.config)
	r.Post("/logout", o.logout)
	if o.localEnabled {
		// Local username/password accounts.
		r.Post("/register", o.register)
		r.Post("/login", o.localLogin)
		// Email verification + password recovery.
		r.Post("/verify-email", o.verifyEmail)
		r.Post("/resend-verification", o.resendVerification)
		r.Post("/forgot-password", o.forgotPassword)
		r.Post("/reset-password", o.resetPassword)
		// TOTP two-factor: enroll while signed in, then a code challenge at login.
		r.Post("/2fa/setup", o.twofaSetup)
		r.Post("/2fa/enable", o.twofaEnable)
		r.Post("/2fa/disable", o.twofaDisable)
		r.Post("/2fa/verify", o.twofaVerify)
	}
	if o.devEnabled {
		// Dev-only login shortcut (no real OAuth provider required).
		r.Get("/dev/login", o.devLogin)
	}
	r.Get("/{provider}/login", o.login)
	r.Get("/{provider}/callback", o.callback)
}

// config reports the available auth options to the frontend.
func (o *OAuth) config(w http.ResponseWriter, r *http.Request) {
	providers := make([]string, 0, len(goth.GetProviders()))
	for name := range goth.GetProviders() {
		providers = append(providers, name)
	}
	sort.Strings(providers)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"devLogin":  o.devEnabled,
		"localAuth": o.localEnabled,
		"providers": providers,
		"version":   version.Current,
	})
}

func (o *OAuth) login(w http.ResponseWriter, r *http.Request) {
	provider, err := goth.GetProvider(chi.URLParam(r, "provider"))
	if err != nil {
		http.Error(w, "unknown provider", http.StatusNotFound)
		return
	}

	state := randomState()
	sess, err := provider.BeginAuth(state)
	if err != nil {
		http.Error(w, "failed to begin auth", http.StatusInternalServerError)
		return
	}
	url, err := sess.GetAuthURL()
	if err != nil {
		http.Error(w, "failed to build auth url", http.StatusInternalServerError)
		return
	}

	o.sm.Put(r.Context(), sessionOAuthState, state)
	o.sm.Put(r.Context(), sessionOAuthData, sess.Marshal())
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func (o *OAuth) callback(w http.ResponseWriter, r *http.Request) {
	provider, err := goth.GetProvider(chi.URLParam(r, "provider"))
	if err != nil {
		http.Error(w, "unknown provider", http.StatusNotFound)
		return
	}

	// CSRF: the state we stored must match the one returned by the provider.
	wantState := o.sm.PopString(r.Context(), sessionOAuthState)
	if wantState == "" || r.URL.Query().Get("state") != wantState {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}

	marshaled := o.sm.PopString(r.Context(), sessionOAuthData)
	sess, err := provider.UnmarshalSession(marshaled)
	if err != nil {
		http.Error(w, "invalid oauth session", http.StatusBadRequest)
		return
	}
	if _, err := sess.Authorize(provider, r.URL.Query()); err != nil {
		http.Error(w, "oauth authorization failed", http.StatusUnauthorized)
		return
	}

	gu, err := provider.FetchUser(sess)
	if err != nil {
		http.Error(w, "failed to fetch user", http.StatusBadGateway)
		return
	}

	user, refusal, err := o.resolveIdentity(r.Context(), gu)
	if err != nil {
		http.Error(w, "failed to persist user", http.StatusInternalServerError)
		return
	}
	if refusal != "" {
		// A foreseeable situation, not a server fault: send them back to the
		// door they came from with something they can act on.
		http.Redirect(w, r, "/?authError="+url.QueryEscape(refusal), http.StatusTemporaryRedirect)
		return
	}

	if err := Login(r.Context(), o.sm, user.ID); err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

/*
Which account is standing at the door (#269).

Three cases, in order, and the order is the whole rule:

 1. The door is already hung on an account — the ordinary return visit. Refresh
    what the provider tells us about them and let them in.

 2. Nobody has this door, but somebody already holds this ADDRESS and has
    PROVEN it. Same person, second door: hang it on the account they have.
    Proven matters — an unverified account may be a squatter sitting on
    somebody else's address, and linking to one would hand them the account
    along with everything in it.

 3. Nobody holds the address either. A new person; make them an account and
    hang this door on it.

The one refusal is case 2 with an unverified holder. That address belongs to
whoever can read the mail, and the provider says that is the person standing
here — but the unverified account might be theirs too, registered and never
confirmed, and quietly taking the address off it would be its own kind of
wrong. So they are told, and the way out is to confirm it or sign in as it.
*/
const refusalEmailTaken = "email-taken"

func (o *OAuth) resolveIdentity(ctx context.Context, gu goth.User) (db.User, string, error) {
	// 1. A door we already know.
	user, err := o.queries.GetUserByIdentity(ctx, db.GetUserByIdentityParams{
		Provider: gu.Provider, ProviderID: gu.UserID,
	})
	if err == nil {
		refreshed, err := o.queries.RefreshOAuthProfile(ctx, db.RefreshOAuthProfileParams{
			ID: user.ID, Name: displayName(gu), Image: optional(gu.AvatarURL),
		})
		if err != nil {
			return db.User{}, "", err
		}
		// An account that arrived without an address gains the one the
		// provider vouches for, the first time one is offered. Losing that
		// race to another account is not a reason to refuse a sign-in.
		if gu.Email != "" && nilOrBlank(refreshed.Email) {
			if adopted, err := o.queries.AdoptEmail(ctx, db.AdoptEmailParams{
				ID: refreshed.ID, Email: optional(gu.Email),
			}); err == nil {
				refreshed = adopted
			} else if uniqueField(err) == "" && !errors.Is(err, pgx.ErrNoRows) {
				return db.User{}, "", err
			}
		}
		return refreshed, "", nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, "", err
	}

	// 2. A new door onto an account that already holds this address.
	if gu.Email != "" {
		held, err := o.queries.GetVerifiedUserByEmail(ctx, gu.Email)
		switch {
		case err == nil:
			if _, err := o.queries.LinkIdentity(ctx, db.LinkIdentityParams{
				UserID: held.ID, Provider: gu.Provider, ProviderID: gu.UserID,
			}); err != nil {
				return db.User{}, "", err
			}
			return held, "", nil
		case !errors.Is(err, pgx.ErrNoRows):
			return db.User{}, "", err
		}
		// Held, but never proven. Not ours to hand over.
		if _, err := o.queries.GetAnyUserByEmail(ctx, gu.Email); err == nil {
			return db.User{}, refusalEmailTaken, nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, "", err
		}
	}

	// 3. Nobody at all: a new person.
	fresh, err := o.queries.CreateOAuthUser(ctx, db.CreateOAuthUserParams{
		Name:       displayName(gu),
		Email:      optional(gu.Email),
		Image:      optional(gu.AvatarURL),
		Provider:   gu.Provider,
		ProviderID: gu.UserID,
	})
	if err != nil {
		return db.User{}, "", err
	}
	if _, err := o.queries.LinkIdentity(ctx, db.LinkIdentityParams{
		UserID: fresh.ID, Provider: gu.Provider, ProviderID: gu.UserID,
	}); err != nil {
		return db.User{}, "", err
	}
	return fresh, "", nil
}

func nilOrBlank(s *string) bool { return s == nil || strings.TrimSpace(*s) == "" }

func (o *OAuth) logout(w http.ResponseWriter, r *http.Request) {
	if err := Logout(r.Context(), o.sm); err != nil {
		http.Error(w, "failed to logout", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func displayName(u goth.User) string {
	switch {
	case u.NickName != "":
		return u.NickName
	case u.Name != "":
		return u.Name
	default:
		return u.Email
	}
}

// optional maps an empty string to a nil pointer (NULL), matching sqlc's
// pointer types for nullable columns.
func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func randomState() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
