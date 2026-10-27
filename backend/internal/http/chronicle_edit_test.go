package http

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// Who may reword and strike which chronicle line (#411), and what a typed
// entry becomes.

func TestChronicleRights(t *testing.T) {
	dmID, playerID, otherID := uuid.New(), uuid.New(), uuid.New()
	dm := db.Membership{UserID: dmID, Role: db.MembershipRoleDm}
	player := db.Membership{UserID: playerID, Role: db.MembershipRolePlayer}
	cases := []struct {
		name              string
		kind              string
		actor             uuid.UUID
		who               db.Membership
		canEdit, canStrik bool
	}{
		{"a DM's story note, to a DM", "note", dmID, dm, true, true},
		{"another DM's ruling, to a DM", "ruling", otherID, dm, true, true},
		{"a story note, to a player", "note", dmID, player, false, false},
		{"a player's own chat", "player_note", playerID, player, true, true},
		{"a player's chat, to the DM", "player_note", playerID, dm, false, true},
		{"somebody else's chat, to a player", "player_note", otherID, player, false, false},
		{"the app's record, to the DM", "xp", dmID, dm, false, true},
		{"a player's own roll", "roll", playerID, player, false, false},
		{"a handout line, to a player", "handout", dmID, player, false, false},
	}
	for _, c := range cases {
		edit, strike := eventRights(c.kind, pgUUID(c.actor), c.who)
		if edit != c.canEdit || strike != c.canStrik {
			t.Errorf("%s: edit %v strike %v, want %v %v", c.name, edit, strike, c.canEdit, c.canStrik)
		}
	}
}

func TestChronicleTextKeepsLineBreaks(t *testing.T) {
	got, problem := chronicleText("  The bridge fell.\r\n\r\n\r\n\r\nWe swam.  \nMira lost her hat.\n\n")
	if problem != "" {
		t.Fatal(problem)
	}
	if want := "The bridge fell.\n\nWe swam.\nMira lost her hat."; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if _, problem := chronicleText(" \n\t\n "); problem == "" {
		t.Fatal("an entry of nothing but blank lines should be refused")
	}
	if _, problem := chronicleText(strings.Repeat("é", chronicleMaxRunes)); problem != "" {
		t.Fatalf("2,000 characters should fit, counted in characters not bytes: %s", problem)
	}
	if _, problem := chronicleText(strings.Repeat("a", chronicleMaxRunes+1)); problem == "" {
		t.Fatal("2,001 characters should be refused")
	}
}
