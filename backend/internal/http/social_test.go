package http

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Friends and messages (#181), the parts that can be stated without a
// database: how a friend code is drawn, how a row reads from each side, and
// what the composer will and will not accept.

func TestAFriendCodeIsReadableAloud(t *testing.T) {
	// It is read over a table or a voice call, so the characters people
	// misread — O/0, I/1/L — are simply not in the alphabet.
	for _, bad := range []string{"O", "0", "I", "1", "L"} {
		if strings.Contains(friendCodeAlphabet, bad) {
			t.Fatalf("%q is too easily misheard to be in a code read aloud", bad)
		}
	}
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code, err := newFriendCode()
		if err != nil {
			t.Fatalf("drawing a code: %v", err)
		}
		if len(code) != friendCodeLen {
			t.Fatalf("a code is %d characters, got %q", friendCodeLen, code)
		}
		for _, r := range code {
			if !strings.ContainsRune(friendCodeAlphabet, r) {
				t.Fatalf("%q is not from the alphabet", string(r))
			}
		}
		seen[code] = true
	}
	// Not a distribution test — just that it is drawing rather than repeating.
	if len(seen) < 190 {
		t.Fatalf("200 draws produced only %d codes; that is not random enough to hand out", len(seen))
	}
}

func TestAFriendshipReadsFromBothSides(t *testing.T) {
	me, them := uuid.New(), uuid.New()
	pending := db.ListFriendshipsRow{RequesterID: me, AddresseeID: them, State: "pending"}

	if got := friendDirection(pending, me); got != api.Asked {
		t.Fatalf("the one who asked sees it as asked, got %q", got)
	}
	if got := friendDirection(pending, them); got != api.Invited {
		t.Fatalf("the one asked sees an invitation, got %q", got)
	}

	// Once accepted, who asked stops mattering to either of them.
	accepted := db.ListFriendshipsRow{RequesterID: me, AddresseeID: them, State: "accepted"}
	for _, who := range []uuid.UUID{me, them} {
		if got := friendDirection(accepted, who); got != api.Mutual {
			t.Fatalf("an accepted friendship is mutual from both sides, got %q", got)
		}
	}
}

func TestTheComposerRefusesWhatIsNotAMessage(t *testing.T) {
	for _, empty := range []*api.SendMessageRequest{nil, {Body: ""}, {Body: "   \n\t "}} {
		if _, msg := trimmedBody(empty); msg == "" {
			t.Fatalf("%v should not be sendable", empty)
		}
	}
	long := &api.SendMessageRequest{Body: strings.Repeat("a", maxMessageBody+1)}
	if _, msg := trimmedBody(long); msg == "" {
		t.Fatal("something longer than a message should be refused, not stored")
	}
	body, msg := trimmedBody(&api.SendMessageRequest{Body: "  well met  "})
	if msg != "" {
		t.Fatalf("a real message should be accepted, got %q", msg)
	}
	if body != "well met" {
		t.Fatalf("the padding is the composer's business, got %q", body)
	}
	// Exactly at the ceiling is a message, not one character too many.
	if _, msg := trimmedBody(&api.SendMessageRequest{Body: strings.Repeat("a", maxMessageBody)}); msg != "" {
		t.Fatalf("the ceiling itself should be allowed, got %q", msg)
	}
}

func TestAMessageKnowsWhoseItIs(t *testing.T) {
	me, them := uuid.New(), uuid.New()
	at := pgtype.Timestamptz{Valid: true}

	mine := toAPIMessage(uuid.New(), me, "Me", "well met", at, me)
	if !mine.Mine {
		t.Fatal("a message I sent is mine")
	}
	theirs := toAPIMessage(uuid.New(), them, "Them", "well met", at, me)
	if theirs.Mine {
		t.Fatal("a message they sent is not mine, however alike the words")
	}
}
