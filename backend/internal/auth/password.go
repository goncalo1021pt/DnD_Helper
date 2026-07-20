package auth

import (
	"bufio"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// Password handling for local accounts.
//
// We never store the password. We store a bcrypt hash — a one-way fingerprint
// with a per-password random salt baked in, made deliberately slow (cost 12)
// so a stolen database is expensive to crack. bcrypt only reads the first 72
// bytes of its input, so we first fold the password through SHA-256 and
// base64-encode it (always 44 bytes, no NUL bytes): that removes the length
// limit without weakening anything.

const (
	bcryptCost     = 12
	minPasswordLen = 10
	maxPasswordLen = 128 // guards against absurd inputs; SHA-256 handles length
	minUsernameLen = 3
	maxUsernameLen = 32
)

//go:embed common_passwords.txt
var commonPasswordsRaw string

// commonPasswords is the lowercased blocklist, loaded once at startup.
var commonPasswords = loadCommonPasswords(commonPasswordsRaw)

func loadCommonPasswords(raw string) map[string]struct{} {
	set := make(map[string]struct{})
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		set[strings.ToLower(line)] = struct{}{}
	}
	return set
}

// prehash folds an arbitrary-length password into a fixed 44-byte token so
// bcrypt's 72-byte cap can never silently truncate it.
func prehash(password string) []byte {
	sum := sha256.Sum256([]byte(password))
	encoded := base64.StdEncoding.EncodeToString(sum[:])
	return []byte(encoded)
}

// HashPassword returns the bcrypt hash to store. Validate the password first.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword(prehash(password), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// CheckPassword reports whether password matches the stored bcrypt hash.
// bcrypt's comparison is constant-time, so it leaks no timing information.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), prehash(password)) == nil
}

// ValidatePassword enforces the strength policy: a length floor, a
// common-password blocklist, and a check that the password isn't just the
// user's own username or email. Returns a user-facing message, or "" if valid.
func ValidatePassword(password, username, email string) string {
	if len(password) < minPasswordLen {
		return fmt.Sprintf("Password must be at least %d characters.", minPasswordLen)
	}
	if len(password) > maxPasswordLen {
		return fmt.Sprintf("Password must be at most %d characters.", maxPasswordLen)
	}
	lower := strings.ToLower(strings.TrimSpace(password))
	if _, bad := commonPasswords[lower]; bad {
		return "That password is one of the most common — pick something harder to guess."
	}
	if username != "" && lower == strings.ToLower(username) {
		return "Your password can't be your username."
	}
	if email != "" && lower == strings.ToLower(email) {
		return "Your password can't be your email."
	}
	// Reject a single character repeated (e.g. "aaaaaaaaaa").
	if isSingleRune(lower) {
		return "That password is too simple — vary the characters."
	}
	return ""
}

func isSingleRune(s string) bool {
	if s == "" {
		return false
	}
	first := s[0]
	for i := 1; i < len(s); i++ {
		if s[i] != first {
			return false
		}
	}
	return true
}

// ValidateUsername enforces length and a conservative character set. Returns a
// user-facing message, or "" if valid.
func ValidateUsername(username string) string {
	if len(username) < minUsernameLen {
		return fmt.Sprintf("Username must be at least %d characters.", minUsernameLen)
	}
	if len(username) > maxUsernameLen {
		return fmt.Sprintf("Username must be at most %d characters.", maxUsernameLen)
	}
	for _, r := range username {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '_' || r == '-' || r == '.':
		default:
			return "Username may use letters, numbers, and . _ - only."
		}
	}
	return ""
}
