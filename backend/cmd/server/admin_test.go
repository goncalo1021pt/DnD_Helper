package main

import (
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
The pure corner of the operator command (#111).

Most of unlock-2fa is a database conversation, and it was verified by running
it against a real one — seeding a locked-out account, clearing it, and reading
the row back. What is worth pinning here is the one thing that could panic:
this command runs when somebody is already locked out, and crashing on a null
email would turn a bad evening into a worse one.
*/
func TestEmailOfSurvivesAnAccountWithoutOne(t *testing.T) {
	addr := "bryn@example.com"
	blank := "   "

	if got := emailOf(db.User{Email: &addr}); got != addr {
		t.Errorf("emailOf = %q; want %q", got, addr)
	}
	if got := emailOf(db.User{}); got != "no email" {
		t.Errorf("a null email read as %q; want a placeholder, not a crash", got)
	}
	if got := emailOf(db.User{Email: &blank}); got != "no email" {
		t.Errorf("a blank email read as %q; want a placeholder", got)
	}
}
