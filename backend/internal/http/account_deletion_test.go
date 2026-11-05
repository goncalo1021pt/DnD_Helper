package http

import (
	"strings"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

func TestDeletionMethod(t *testing.T) {
	str := func(s string) *string { return &s }
	cases := []struct {
		name string
		user db.User
		want string
	}{
		{"a password account types its password", db.User{PasswordHash: str("$argon2id$x"), Email: str("a@b.c"), EmailVerified: true}, methodPassword},
		{"a password wins over a confirmed address", db.User{PasswordHash: str("$argon2id$x"), Email: str("a@b.c"), EmailVerified: true}, methodPassword},
		{"a provider account with a confirmed address gets a link", db.User{Email: str("a@b.c"), EmailVerified: true}, methodEmail},
		{"an address nobody confirmed proves nothing", db.User{Email: str("a@b.c")}, methodName},
		{"no address and no password types its name", db.User{}, methodName},
		{"a blank hash is no password", db.User{PasswordHash: str(""), Email: str("a@b.c"), EmailVerified: true}, methodEmail},
		{"a blank address is no address", db.User{Email: str(""), EmailVerified: true}, methodName},
	}
	for _, c := range cases {
		if got := deletionMethod(c.user); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestBlockedMessageNamesEveryTable(t *testing.T) {
	got := blockedMessage([]api.AccountDeletionBlocker{{Name: "The Sealed Letter"}, {Name: "Barovia"}})
	for _, want := range []string{"The Sealed Letter", "Barovia", "hand each table over or disband it"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
}
