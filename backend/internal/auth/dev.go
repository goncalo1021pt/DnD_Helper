package auth

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/markbates/goth"
)

// devLogin is a development-only shortcut that creates/logs in a user without a
// real OAuth provider, so the app is usable locally before Discord/Google are
// configured. It is only mounted when dev auth is enabled (non-production).
func (o *OAuth) devLogin(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "Dev User"
	}
	// A provider vouches for an address, and the dev door stands in for a
	// provider — so it can carry one. Without this, the linking rules (#269)
	// would be the one part of sign-in no test could reach: real OAuth cannot
	// be driven from a browser test, and every other door is address-less.
	// `id` separates WHO the provider says this is from what they are called,
	// which is what a second door onto one person looks like.
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	id := r.URL.Query().Get("id")
	if id == "" {
		id = name // stable per name, as it always was
	}

	// Through the same door resolution as a real provider (#269), so the one
	// path everything signs in by is the one that is exercised locally and by
	// the e2e suite — a dev shortcut with its own account rules would be a
	// second implementation of the thing most worth getting right.
	user, refusal, err := o.resolveIdentity(r.Context(), goth.User{
		Provider: "dev",
		UserID:   id,
		Name:     name,
		Email:    email,
	})
	if err != nil {
		http.Error(w, "failed to create dev user", http.StatusInternalServerError)
		return
	}
	if refusal != "" {
		http.Redirect(w, r, "/?authError="+url.QueryEscape(refusal), http.StatusTemporaryRedirect)
		return
	}

	if err := Login(r.Context(), o.sm, user.ID); err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}
