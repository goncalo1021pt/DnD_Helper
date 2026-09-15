package auth

import (
	"crypto/rand"
	"encoding/base64"
)

// TokenPrefix opens every API token (#294): a secret found in a log or a
// repository can be recognised, and a scanner can be taught to look for it.
const TokenPrefix = "qb_"

// tokenDisplay is how much of the secret a list row shows — enough to match a
// leaked token to its row, nowhere near enough to use it.
const tokenDisplay = 8

// NewAPIToken mints a token: the raw secret to show once, the hash to store,
// and the display prefix. 32 random bytes, base64url — 43 characters after
// the prefix, which is not brute-forceable at any request rate.
func NewAPIToken() (raw, hash, prefix string) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	raw = TokenPrefix + base64.RawURLEncoding.EncodeToString(b)
	return raw, HashAPIToken(raw), raw[:len(TokenPrefix)+tokenDisplay]
}

// HashAPIToken is what the database keys on — the same SHA-256 the email
// tokens use, so a leaked table can be used to verify nothing.
func HashAPIToken(raw string) string {
	return hashToken(raw)
}
