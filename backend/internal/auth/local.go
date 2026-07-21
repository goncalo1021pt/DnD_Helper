package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// Local username/password auth. These are hand-rolled routes (like the OAuth
// and dev routes) that live outside the OpenAPI contract. Registration takes an
// email, a username, and a password; sign-in accepts either the username or the
// email. Passwords are validated for strength and stored only as bcrypt hashes.

// A fixed valid bcrypt hash, compared against on failed username lookups so a
// missing account costs the same time as a wrong password — no user
// enumeration through timing. Computed once at startup.
var dummyHash, _ = HashPassword("qb-timing-equalizer-not-a-real-secret")

type registerRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginRequest struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

// authError writes a structured JSON error the frontend can attach to a field.
func authError(w http.ResponseWriter, status int, field, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"field": field, "error": message})
}

func (o *OAuth) register(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if o.loginLimiter.blocked(ip, time.Now()) {
		authError(w, http.StatusTooManyRequests, "", "Too many attempts — wait a few minutes and try again.")
		return
	}

	var req registerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}

	username := strings.TrimSpace(req.Username)
	email := strings.ToLower(strings.TrimSpace(req.Email))

	if msg := ValidateUsername(username); msg != "" {
		authError(w, http.StatusBadRequest, "username", msg)
		return
	}
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
		authError(w, http.StatusBadRequest, "email", "That doesn't look like a valid email address.")
		return
	}
	if msg := ValidatePassword(req.Password, username, email); msg != "" {
		authError(w, http.StatusBadRequest, "password", msg)
		return
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		http.Error(w, "failed to secure password", http.StatusInternalServerError)
		return
	}

	user, err := o.queries.CreateLocalUser(r.Context(), db.CreateLocalUserParams{
		Name:         username,
		Username:     ptr(username),
		Email:        ptr(email),
		PasswordHash: ptr(hash),
	})
	if err != nil {
		switch uniqueField(err) {
		// provider_id mirrors lower(username) for local accounts, so a
		// (provider, provider_id) collision is a username collision too.
		case "idx_users_username", "users_provider_provider_id_key":
			o.loginLimiter.record(ip, time.Now())
			authError(w, http.StatusConflict, "username", "That username is already taken.")
		case "idx_users_local_email":
			o.loginLimiter.record(ip, time.Now())
			authError(w, http.StatusConflict, "email", "An account with that email already exists.")
		default:
			http.Error(w, "failed to create account", http.StatusInternalServerError)
		}
		return
	}

	// Send the confirmation email (best-effort) before logging them in — they
	// enter unverified and are nudged to confirm.
	o.sendVerification(r.Context(), user.ID, email)

	if err := Login(r.Context(), o.sm, user.ID); err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (o *OAuth) localLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if o.loginLimiter.blocked(ip, time.Now()) {
		authError(w, http.StatusTooManyRequests, "", "Too many attempts — wait a few minutes and try again.")
		return
	}

	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}
	identifier := strings.TrimSpace(req.Identifier)
	if identifier == "" || req.Password == "" {
		authError(w, http.StatusBadRequest, "", "Enter your username or email and your password.")
		return
	}

	user, err := o.queries.GetLocalUserByLogin(r.Context(), identifier)
	if err != nil {
		// Spend the same time as a real compare so a missing account and a
		// wrong password are indistinguishable.
		CheckPassword(dummyHash, req.Password)
		o.loginLimiter.record(ip, time.Now())
		authError(w, http.StatusUnauthorized, "", "Invalid username or password.")
		return
	}
	if user.PasswordHash == nil || !CheckPassword(*user.PasswordHash, req.Password) {
		o.loginLimiter.record(ip, time.Now())
		authError(w, http.StatusUnauthorized, "", "Invalid username or password.")
		return
	}

	// Password is right. If this account carries a second factor, don't
	// authenticate yet — park a pending challenge in the session and let the
	// client collect a code (see twofaVerify).
	if user.TotpEnabled {
		o.sm.Put(r.Context(), sessionPending2FA, user.ID.String())
		o.sm.Put(r.Context(), sessionPending2FAAt, int(time.Now().Unix()))
		writeJSON(w, http.StatusOK, map[string]bool{"twofaRequired": true})
		return
	}

	if err := Login(r.Context(), o.sm, user.ID); err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ptr returns a pointer to s, matching sqlc's pointer types for text columns.
func ptr(s string) *string { return &s }

// uniqueField returns the constraint/index name of a unique-violation error, or
// "" if err is not a unique violation.
func uniqueField(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return pgErr.ConstraintName
	}
	return ""
}
