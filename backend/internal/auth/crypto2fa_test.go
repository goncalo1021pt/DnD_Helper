package auth

import (
	"regexp"
	"testing"
)

func TestDeriveTOTPKeyDeterministic(t *testing.T) {
	a := deriveTOTPKey("session-key-abc")
	b := deriveTOTPKey("session-key-abc")
	if a != b {
		t.Error("deriveTOTPKey is not deterministic for the same SESSION_KEY")
	}
	if c := deriveTOTPKey("session-key-xyz"); a == c {
		t.Error("different SESSION_KEYs must derive different TOTP keys")
	}
}

func TestEncryptDecryptSecretRoundTrip(t *testing.T) {
	key := deriveTOTPKey("the-session-key")
	const secret = "JBSWY3DPEHPK3PXP" // a base32 TOTP secret

	enc, err := encryptSecret(key, secret)
	if err != nil {
		t.Fatalf("encryptSecret: %v", err)
	}
	if enc == secret {
		t.Fatal("ciphertext must not equal the plaintext secret")
	}

	got, err := decryptSecret(key, enc)
	if err != nil {
		t.Fatalf("decryptSecret: %v", err)
	}
	if got != secret {
		t.Errorf("round-trip mismatch: got %q, want %q", got, secret)
	}

	// Nonce is random, so encrypting twice yields different ciphertext.
	enc2, _ := encryptSecret(key, secret)
	if enc == enc2 {
		t.Error("two encryptions of the same secret should differ (random nonce)")
	}
}

func TestDecryptSecretFailures(t *testing.T) {
	key := deriveTOTPKey("key-one")
	enc, err := encryptSecret(key, "topsecret")
	if err != nil {
		t.Fatalf("encryptSecret: %v", err)
	}

	if _, err := decryptSecret(deriveTOTPKey("key-two"), enc); err == nil {
		t.Error("decrypt with the wrong key should fail")
	}
	if _, err := decryptSecret(key, "not-valid-base64!!"); err == nil {
		t.Error("decrypt of non-base64 should fail")
	}
	if _, err := decryptSecret(key, "AAAA"); err == nil {
		t.Error("decrypt of a too-short ciphertext should fail")
	}

	// Flip a byte of the ciphertext: GCM authentication must reject it.
	tampered := []byte(enc)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := decryptSecret(key, string(tampered)); err == nil {
		t.Error("decrypt of tampered ciphertext should fail authentication")
	}
}

func TestNewRecoveryCodes(t *testing.T) {
	const n = 10
	raw, hashes := newRecoveryCodes(n)

	if len(raw) != n || len(hashes) != n {
		t.Fatalf("expected %d codes and hashes, got %d and %d", n, len(raw), len(hashes))
	}

	codeRE := regexp.MustCompile(`^[0-9a-f]{4}-[0-9a-f]{4}$`)
	seen := map[string]bool{}
	for i, code := range raw {
		if !codeRE.MatchString(code) {
			t.Errorf("code %q does not match the expected xxxx-xxxx format", code)
		}
		if seen[code] {
			t.Errorf("duplicate recovery code generated: %q", code)
		}
		seen[code] = true
		if hashes[i] != hashToken(code) {
			t.Errorf("stored hash for %q is not hashToken(code)", code)
		}
	}
}

func TestNormalizeRecovery(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"3f9a-1c7e", "3f9a-1c7e"},
		{"3f9a1c7e", "3f9a-1c7e"},
		{"3F9A-1C7E", "3f9a-1c7e"},
		{" 3f9a 1c7e ", "3f9a-1c7e"},
		{"3F9A 1C7E", "3f9a-1c7e"},
		{"short", "short"}, // wrong length: returned lowercased, unformatted
	}
	for _, tc := range tests {
		if got := normalizeRecovery(tc.in); got != tc.want {
			t.Errorf("normalizeRecovery(%q) = %q; want %q", tc.in, got, tc.want)
		}
	}
}

func TestHashToken(t *testing.T) {
	h := hashToken("3f9a-1c7e")
	if len(h) != 64 {
		t.Errorf("hashToken should be 64 hex chars (sha256), got %d", len(h))
	}
	if hashToken("3f9a-1c7e") != h {
		t.Error("hashToken must be deterministic")
	}
	if hashToken("3f9a-1c7f") == h {
		t.Error("different inputs must hash differently")
	}
}
