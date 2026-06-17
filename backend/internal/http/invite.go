package http

import (
	"crypto/rand"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// inviteAlphabet excludes visually ambiguous characters (0/O, 1/I/L) so codes
// are easy to read aloud and type.
const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const inviteCodeLength = 6

// generateInviteCode returns a random, human-friendly campaign invite code.
func generateInviteCode() string {
	b := make([]byte, inviteCodeLength)
	_, _ = rand.Read(b)
	out := make([]byte, inviteCodeLength)
	for i, v := range b {
		out[i] = inviteAlphabet[int(v)%len(inviteAlphabet)]
	}
	return string(out)
}

// normalizeInviteCode trims and upper-cases user-entered codes to match storage.
func normalizeInviteCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// isUniqueViolation reports whether err is a Postgres unique-constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
