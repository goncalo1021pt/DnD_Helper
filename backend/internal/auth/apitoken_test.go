package auth

import (
	"regexp"
	"strings"
	"testing"
)

func TestNewAPIToken(t *testing.T) {
	raw, hash, prefix := NewAPIToken()
	if !strings.HasPrefix(raw, TokenPrefix) {
		t.Fatalf("token should open with %q, got %q", TokenPrefix, raw)
	}
	// 32 bytes base64url without padding is 43 characters.
	if len(raw) != len(TokenPrefix)+43 {
		t.Fatalf("token length %d, want %d", len(raw), len(TokenPrefix)+43)
	}
	if prefix != raw[:len(TokenPrefix)+tokenDisplay] {
		t.Fatalf("prefix %q should be the first %d characters of %q", prefix, len(TokenPrefix)+tokenDisplay, raw)
	}
	if hash != HashAPIToken(raw) {
		t.Fatal("the stored hash must be what the door recomputes from the raw secret")
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(hash) {
		t.Fatalf("hash should be SHA-256 hex, got %q", hash)
	}
	if strings.Contains(hash, raw[len(TokenPrefix):]) {
		t.Fatal("the hash must not carry the secret")
	}
	again, _, _ := NewAPIToken()
	if again == raw {
		t.Fatal("two mints must differ")
	}
}
