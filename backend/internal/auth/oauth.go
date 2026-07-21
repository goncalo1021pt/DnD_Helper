package auth

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/alexedwards/scs/v2"
	"github.com/go-chi/chi/v5"
	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/discord"
	"github.com/markbates/goth/providers/google"

	"github.com/goncalo1021pt/questboard/backend/internal/config"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
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
	mailer       mail.Mailer
	baseURL      string
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

func NewOAuth(sm *scs.SessionManager, queries *db.Queries, devEnabled, localEnabled bool, mailer mail.Mailer, baseURL string) *OAuth {
	return &OAuth{
		sm:           sm,
		queries:      queries,
		devEnabled:   devEnabled,
		localEnabled: localEnabled,
		// Up to 25 FAILED auth attempts per IP per 15 minutes; successes don't
		// count, so a shared-IP table of players is never locked out.
		loginLimiter: newRateLimiter(25, 15*time.Minute),
		mailer:       mailer,
		baseURL:      baseURL,
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

	user, err := o.queries.UpsertUser(r.Context(), db.UpsertUserParams{
		Name:       displayName(gu),
		Email:      optional(gu.Email),
		Image:      optional(gu.AvatarURL),
		Provider:   gu.Provider,
		ProviderID: gu.UserID,
	})
	if err != nil {
		http.Error(w, "failed to persist user", http.StatusInternalServerError)
		return
	}

	if err := Login(r.Context(), o.sm, user.ID); err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

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
