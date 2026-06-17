package auth

import (
	"net/http"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// devLogin is a development-only shortcut that creates/logs in a user without a
// real OAuth provider, so the app is usable locally before Discord/Google are
// configured. It is only mounted when dev auth is enabled (non-production).
func (o *OAuth) devLogin(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "Dev User"
	}

	user, err := o.queries.UpsertUser(r.Context(), db.UpsertUserParams{
		Name:       name,
		Provider:   "dev",
		ProviderID: name, // stable per name in dev
	})
	if err != nil {
		http.Error(w, "failed to create dev user", http.StatusInternalServerError)
		return
	}

	Login(r.Context(), o.sm, user.ID)
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}
