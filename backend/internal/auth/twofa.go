package auth

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pquerna/otp/totp"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// TOTP two-factor auth for local accounts. Enrollment (setup → enable) happens
// while signed in from the profile; at the next sign-in the password step is
// followed by a code challenge. OAuth users are protected by their provider and
// are refused enrollment here.

const (
	sessionPending2FA   = "pending_2fa_user" // user id awaiting a code, not yet authenticated
	sessionPending2FAAt = "pending_2fa_at"   // unix seconds the challenge began
	pending2FATTL       = 5 * time.Minute
	recoveryCodeCount   = 10
)

// twofaSetup mints a fresh secret for the signed-in local user and returns the
// otpauth URL, the base32 secret (for manual entry), and a QR PNG. It does NOT
// enable 2FA — the user must confirm a code via twofaEnable first.
func (o *OAuth) twofaSetup(w http.ResponseWriter, r *http.Request) {
	uid, ok := UserID(r.Context())
	if !ok {
		authError(w, http.StatusUnauthorized, "", "Sign in first.")
		return
	}
	user, err := o.queries.GetUserByID(r.Context(), uid)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if user.Provider != "local" {
		authError(w, http.StatusBadRequest, "", "Two-factor auth is only for password accounts; your provider already secures sign-in.")
		return
	}
	if user.TotpEnabled {
		authError(w, http.StatusBadRequest, "", "Two-factor auth is already on. Turn it off first to re-enroll.")
		return
	}

	account := user.Name
	if user.Email != nil && *user.Email != "" {
		account = *user.Email
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: "Quest Board", AccountName: account})
	if err != nil {
		http.Error(w, "failed to generate secret", http.StatusInternalServerError)
		return
	}
	enc, err := encryptSecret(o.totpKey, key.Secret())
	if err != nil {
		http.Error(w, "failed to secure secret", http.StatusInternalServerError)
		return
	}
	if err := o.queries.SetTOTPSecret(r.Context(), db.SetTOTPSecretParams{ID: uid, TotpSecret: ptr(enc)}); err != nil {
		http.Error(w, "failed to store secret", http.StatusInternalServerError)
		return
	}

	img, err := key.Image(220, 220)
	if err != nil {
		http.Error(w, "failed to render qr", http.StatusInternalServerError)
		return
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		http.Error(w, "failed to encode qr", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"otpauthUrl": key.String(),
		"secret":     key.Secret(),
		"qrPng":      "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
	})
}

// twofaEnable confirms enrollment: the user proves they can produce a code, and
// we turn 2FA on and hand back one-time recovery codes.
func (o *OAuth) twofaEnable(w http.ResponseWriter, r *http.Request) {
	uid, ok := UserID(r.Context())
	if !ok {
		authError(w, http.StatusUnauthorized, "", "Sign in first.")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}
	user, err := o.queries.GetUserByID(r.Context(), uid)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if user.TotpEnabled {
		authError(w, http.StatusBadRequest, "", "Two-factor auth is already on.")
		return
	}
	if user.TotpSecret == nil {
		authError(w, http.StatusBadRequest, "", "Start the setup first.")
		return
	}
	secret, err := decryptSecret(o.totpKey, *user.TotpSecret)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if !totp.Validate(strings.TrimSpace(req.Code), secret) {
		authError(w, http.StatusBadRequest, "code", "That code didn't match — check your authenticator and try again.")
		return
	}
	if err := o.queries.EnableTOTP(r.Context(), uid); err != nil {
		http.Error(w, "failed to enable", http.StatusInternalServerError)
		return
	}

	// Fresh recovery codes; replace any left from a prior enrollment.
	_ = o.queries.DeleteRecoveryCodes(r.Context(), uid)
	raw, hashes := newRecoveryCodes(recoveryCodeCount)
	for _, h := range hashes {
		if err := o.queries.AddRecoveryCode(r.Context(), db.AddRecoveryCodeParams{UserID: uid, CodeHash: h}); err != nil {
			http.Error(w, "failed to store recovery codes", http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": raw})
}

// twofaDisable turns 2FA off. Re-authenticate with the account password so a
// walk-up on an open session can't strip the second factor.
func (o *OAuth) twofaDisable(w http.ResponseWriter, r *http.Request) {
	uid, ok := UserID(r.Context())
	if !ok {
		authError(w, http.StatusUnauthorized, "", "Sign in first.")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}
	user, err := o.queries.GetUserByID(r.Context(), uid)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if user.PasswordHash == nil || !CheckPassword(*user.PasswordHash, req.Password) {
		authError(w, http.StatusUnauthorized, "password", "That password is incorrect.")
		return
	}
	if err := o.queries.DisableTOTP(r.Context(), uid); err != nil {
		http.Error(w, "failed to disable", http.StatusInternalServerError)
		return
	}
	_ = o.queries.DeleteRecoveryCodes(r.Context(), uid)
	w.WriteHeader(http.StatusNoContent)
}

// twofaVerify completes a login that was paused for the code challenge. It reads
// the pending user from the session (set by localLogin), validates a TOTP or
// recovery code, and only then promotes the session to authenticated.
func (o *OAuth) twofaVerify(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if o.loginLimiter.blocked(ip, time.Now()) {
		authError(w, http.StatusTooManyRequests, "", "Too many attempts — wait a few minutes and try again.")
		return
	}
	pending := o.sm.GetString(r.Context(), sessionPending2FA)
	startedAt := o.sm.GetInt(r.Context(), sessionPending2FAAt)
	if pending == "" || time.Since(time.Unix(int64(startedAt), 0)) > pending2FATTL {
		o.clearPending(r)
		authError(w, http.StatusUnauthorized, "", "Your sign-in expired. Enter your username and password again.")
		return
	}
	uid, err := uuid.Parse(pending)
	if err != nil {
		o.clearPending(r)
		authError(w, http.StatusUnauthorized, "", "Your sign-in expired. Enter your username and password again.")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		authError(w, http.StatusBadRequest, "", "The request could not be read.")
		return
	}
	user, err := o.queries.GetUserByID(r.Context(), uid)
	if err != nil || !user.TotpEnabled || user.TotpSecret == nil {
		o.clearPending(r)
		authError(w, http.StatusUnauthorized, "", "Your sign-in expired. Enter your username and password again.")
		return
	}

	code := strings.TrimSpace(req.Code)
	ok := false
	if secret, err := decryptSecret(o.totpKey, *user.TotpSecret); err == nil && totp.Validate(code, secret) {
		ok = true
	} else if rc, err := o.queries.GetRecoveryCode(r.Context(), db.GetRecoveryCodeParams{UserID: uid, CodeHash: hashToken(normalizeRecovery(code))}); err == nil {
		_ = o.queries.UseRecoveryCode(r.Context(), rc.ID)
		ok = true
	}
	if !ok {
		o.loginLimiter.record(ip, time.Now())
		authError(w, http.StatusUnauthorized, "code", "That code didn't match. Use an authenticator code or one of your recovery codes.")
		return
	}

	o.clearPending(r)
	if err := Login(r.Context(), o.sm, uid); err != nil {
		http.Error(w, "failed to start session", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (o *OAuth) clearPending(r *http.Request) {
	o.sm.Remove(r.Context(), sessionPending2FA)
	o.sm.Remove(r.Context(), sessionPending2FAAt)
}

// normalizeRecovery accepts "3f9a-1c7e", "3f9a1c7e", or spaced/upper variants
// and returns the canonical "3f9a-1c7e" form the hash was taken over.
func normalizeRecovery(s string) string {
	s = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), " ", ""))
	s = strings.ReplaceAll(s, "-", "")
	if len(s) == 8 {
		return s[:4] + "-" + s[4:]
	}
	return s
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
