package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
)

const (
	verifyTokenTTL = 24 * time.Hour
	resetTokenTTL  = 1 * time.Hour
)

// newEmailToken returns a random URL-safe token to put in a link, and its
// SHA-256 (hex) to store — we never persist the raw token.
func newEmailToken() (raw, hash string) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, hashToken(raw)
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func pgTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// sendVerification mints a verify token and emails the confirmation link.
// Best-effort: failures are logged, never surfaced (they'd leak account state).
func (o *OAuth) sendVerification(ctx context.Context, userID uuid.UUID, email string) {
	raw, hash := newEmailToken()
	if _, err := o.queries.CreateEmailToken(ctx, db.CreateEmailTokenParams{
		UserID:    userID,
		Purpose:   "verify",
		TokenHash: hash,
		ExpiresAt: pgTime(time.Now().Add(verifyTokenTTL)),
	}); err != nil {
		log.Printf("email: create verify token: %v", err)
		return
	}
	link := o.baseURL + "/verify-email?token=" + url.QueryEscape(raw)
	subject, htmlBody, textBody := mail.VerifyEmail(link)
	if err := o.mailer.Send(ctx, email, subject, htmlBody, textBody); err != nil {
		log.Printf("email: send verify to %s: %v", email, err)
	}
}

// verifyEmail confirms an address from the emailed link. The token is the
// proof, so this route needs no session.
func (o *OAuth) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}
	tok, err := o.queries.GetEmailToken(r.Context(), hashToken(strings.TrimSpace(req.Token)))
	if err != nil || tok.Purpose != "verify" {
		authError(w, http.StatusBadRequest, "", "This confirmation link is invalid or has expired.")
		return
	}
	if err := o.queries.SetEmailVerified(r.Context(), tok.UserID); err != nil {
		http.Error(w, "failed to verify", http.StatusInternalServerError)
		return
	}
	_ = o.queries.UseEmailToken(r.Context(), tok.ID)
	w.WriteHeader(http.StatusNoContent)
}

// resendVerification re-sends the confirmation email to the signed-in user.
func (o *OAuth) resendVerification(w http.ResponseWriter, r *http.Request) {
	uid, ok := UserID(r.Context())
	if !ok {
		authError(w, http.StatusUnauthorized, "", "Sign in first.")
		return
	}
	if o.loginLimiter.blocked(clientIP(r), time.Now()) {
		authError(w, http.StatusTooManyRequests, "", "Too many attempts — wait a few minutes and try again.")
		return
	}
	user, err := o.queries.GetUserByID(r.Context(), uid)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	// Nothing to do for verified accounts or those without a local email.
	if !user.EmailVerified && user.Email != nil && *user.Email != "" {
		o.loginLimiter.record(clientIP(r), time.Now())
		o.sendVerification(r.Context(), user.ID, *user.Email)
	}
	w.WriteHeader(http.StatusNoContent)
}

// forgotPassword emails a reset link to a verified local account. It always
// answers 204 so it never reveals whether an address has an account.
func (o *OAuth) forgotPassword(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if o.loginLimiter.blocked(ip, time.Now()) {
		authError(w, http.StatusTooManyRequests, "", "Too many attempts — wait a few minutes and try again.")
		return
	}
	o.loginLimiter.record(ip, time.Now()) // cap reset emails per IP
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	user, err := o.queries.GetLocalUserByEmail(r.Context(), email)
	// Only verified accounts can recover — but the response is identical
	// either way, so an attacker learns nothing.
	if err == nil && user.EmailVerified {
		raw, hash := newEmailToken()
		if _, err := o.queries.CreateEmailToken(r.Context(), db.CreateEmailTokenParams{
			UserID:    user.ID,
			Purpose:   "reset",
			TokenHash: hash,
			ExpiresAt: pgTime(time.Now().Add(resetTokenTTL)),
		}); err == nil {
			link := o.baseURL + "/reset-password?token=" + url.QueryEscape(raw)
			subject, htmlBody, textBody := mail.ResetPassword(link)
			if err := o.mailer.Send(r.Context(), *user.Email, subject, htmlBody, textBody); err != nil {
				log.Printf("email: send reset to %s: %v", *user.Email, err)
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// resetPassword sets a new password from the emailed link's token.
func (o *OAuth) resetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}
	tok, err := o.queries.GetEmailToken(r.Context(), hashToken(strings.TrimSpace(req.Token)))
	if err != nil || tok.Purpose != "reset" {
		authError(w, http.StatusBadRequest, "", "This reset link is invalid or has expired.")
		return
	}
	user, err := o.queries.GetUserByID(r.Context(), tok.UserID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	username, email := "", ""
	if user.Username != nil {
		username = *user.Username
	}
	if user.Email != nil {
		email = *user.Email
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
	if err := o.queries.SetPassword(r.Context(), db.SetPasswordParams{ID: user.ID, PasswordHash: &hash}); err != nil {
		http.Error(w, "failed to set password", http.StatusInternalServerError)
		return
	}
	_ = o.queries.UseEmailToken(r.Context(), tok.ID)
	_ = o.queries.InvalidateUserTokens(r.Context(), db.InvalidateUserTokensParams{UserID: user.ID, Purpose: "reset"})
	w.WriteHeader(http.StatusNoContent)
}
