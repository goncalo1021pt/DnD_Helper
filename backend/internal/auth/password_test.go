package auth

import (
	"strings"
	"testing"
)

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name         string
		pw, user, em string
		wantValid    bool
	}{
		{"typical strong", "correct-horse-7", "alice", "alice@example.com", true},
		{"exactly min length", "zx9-plumQw", "", "", true}, // 10 chars
		{"one under min", "zx9-plumQ", "", "", false},      // 9 chars
		{"over max length", strings.Repeat("a", maxPasswordLen+1), "", "", false},
		{"common password", "password123", "", "", false},
		{"common with surrounding spaces still caught", "  password123  ", "", "", false},
		{"equals username", "alicewonder", "alicewonder", "", false},
		{"equals username case-insensitively", "AliceWonder", "alicewonder", "", false},
		{"equals email", "alice@example.com", "", "alice@example.com", false},
		{"single repeated rune", strings.Repeat("q", minPasswordLen), "", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			msg := ValidatePassword(tc.pw, tc.user, tc.em)
			if got := msg == ""; got != tc.wantValid {
				t.Fatalf("ValidatePassword(%q,%q,%q) = %q; wantValid=%v", tc.pw, tc.user, tc.em, msg, tc.wantValid)
			}
		})
	}
}

func TestValidateUsername(t *testing.T) {
	tests := []struct {
		name      string
		user      string
		wantValid bool
	}{
		{"typical", "rowan_9", true},
		{"dots and dashes", "ro.wan-9", true},
		{"min length", "abc", true},
		{"one under min", "ab", false},
		{"max length", strings.Repeat("a", maxUsernameLen), true},
		{"over max", strings.Repeat("a", maxUsernameLen+1), false},
		{"space not allowed", "bad name", false},
		{"at sign not allowed", "bad@name", false},
		{"slash not allowed", "bad/name", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			msg := ValidateUsername(tc.user)
			if got := msg == ""; got != tc.wantValid {
				t.Fatalf("ValidateUsername(%q) = %q; wantValid=%v", tc.user, msg, tc.wantValid)
			}
		})
	}
}

func TestIsSingleRune(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"", false},
		{"a", true},
		{"aaaa", true},
		{"aaab", false},
		{" abab", false},
	}
	for _, tc := range tests {
		if got := isSingleRune(tc.in); got != tc.want {
			t.Errorf("isSingleRune(%q) = %v; want %v", tc.in, got, tc.want)
		}
	}
}

func TestHashAndCheckPassword(t *testing.T) {
	const pw = "correct-horse-battery-7"

	hash, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == pw {
		t.Fatal("hash must not equal the plaintext password")
	}
	if !CheckPassword(hash, pw) {
		t.Error("CheckPassword rejected the correct password")
	}
	if CheckPassword(hash, "correct-horse-battery-8") {
		t.Error("CheckPassword accepted a wrong password")
	}

	// A distinct hash of the same password (random per-password salt).
	hash2, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("HashPassword (2nd): %v", err)
	}
	if hash == hash2 {
		t.Error("two hashes of the same password should differ (salting)")
	}
	if !CheckPassword(hash2, pw) {
		t.Error("second hash failed to verify")
	}
}

// A password longer than bcrypt's 72-byte input cap must still round-trip, and
// two long passwords that share a 72-byte prefix must not collide — that is the
// whole point of the SHA-256 pre-hash.
func TestLongPasswordNotTruncated(t *testing.T) {
	long1 := strings.Repeat("A", 100) + "-tail-one"
	long2 := strings.Repeat("A", 100) + "-tail-two"

	hash, err := HashPassword(long1)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !CheckPassword(hash, long1) {
		t.Error("long password failed to verify against its own hash")
	}
	if CheckPassword(hash, long2) {
		t.Error("passwords sharing a 72-byte prefix collided — pre-hash not applied")
	}
}
