package webhooks

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strconv"
)

// SecretPrefix opens every signing secret, as qb_ opens every token, so one
// found in the wild can be recognised.
const SecretPrefix = "whsec_"

// NewSecret mints a signing secret: 32 random bytes, base64url.
func NewSecret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return SecretPrefix + base64.RawURLEncoding.EncodeToString(b)
}

// Sign is the signature a receiver checks: HMAC-SHA256 over the timestamp,
// a dot, and the raw body, under the hook's secret. The timestamp is inside
// the signed text so a captured delivery cannot be replayed later with a
// fresh header.
func Sign(secret string, timestamp int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// Verify is what a receiver does — here so the tests and the docs snippet
// are held to the same arithmetic.
func Verify(secret string, timestamp int64, body []byte, signature string) bool {
	return hmac.Equal([]byte(Sign(secret, timestamp, body)), []byte(signature))
}
