package http

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Friends and messages (#181), the parts that can be stated without a
// database: how a friend code is drawn, how a row reads from each side, and
// what the composer will and will not accept.

func TestAFriendTagReadsBack(t *testing.T) {
	cases := []struct {
		raw, name, digits string
		ok                bool
	}{
		{"Sam#4821", "Sam", "4821", true},
		{"  sam #0042 ", "sam", "0042", true},
		{"Mary   Ann#1234", "Mary Ann", "1234", true},
		// The split is on the last hash, so a name may carry one of its own.
		{"No#1 Fan#0007", "No#1 Fan", "0007", true},
		{"Sam#0000", "", "", false},
		{"Sam#482", "", "", false},
		{"Sam#48210", "", "", false},
		{"Sam#48a1", "", "", false},
		{"#4821", "", "", false},
		{"Sam4821", "", "", false},
		{"3F9AWC2E", "", "", false}, // an old code is not a tag
	}
	for _, c := range cases {
		name, digits, ok := parseFriendTag(c.raw)
		if ok != c.ok || name != c.name || digits != c.digits {
			t.Errorf("parseFriendTag(%q) = %q, %q, %v; want %q, %q, %v", c.raw, name, digits, ok, c.name, c.digits, c.ok)
		}
	}
	if got := friendTag("Sam", "4821"); got != "Sam#4821" {
		t.Errorf("friendTag wrote %q", got)
	}
}

func TestDrawnDigitsAreATag(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 500; i++ {
		d, err := drawDigits()
		if err != nil {
			t.Fatalf("drawing digits: %v", err)
		}
		if _, _, ok := parseFriendTag("Sam#" + d); !ok {
			t.Fatalf("drew %q, which is not four digits a tag accepts", d)
		}
		seen[d] = true
	}
	if len(seen) < 450 {
		t.Fatalf("500 draws produced only %d distinct tags; that is not drawing", len(seen))
	}
}

func TestMissesAreCountedForAnHour(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	l := newMissLedger()
	l.now = func() time.Time { return now }
	me, other := uuid.New(), uuid.New()
	for i := 0; i < tagMissLimit; i++ {
		if w := l.wait(me); w != 0 {
			t.Fatalf("refused after %d misses; the ceiling is %d", i, tagMissLimit)
		}
		l.miss(me)
		now = now.Add(time.Minute)
	}
	if w := l.wait(me); w <= 0 {
		t.Fatal("ten misses in ten minutes should close the door")
	}
	if w := l.wait(other); w != 0 {
		t.Fatal("one person's misses must not count against another")
	}
	// The oldest miss was at 12:00; at 13:00 it has aged out and one try is back.
	now = time.Date(2026, 10, 19, 13, 0, 0, 0, time.UTC)
	if w := l.wait(me); w != 0 {
		t.Fatalf("the oldest miss is an hour old, yet the door still waits %v", w)
	}
	var nilLedger *missLedger
	nilLedger.miss(me)
	if nilLedger.wait(me) != 0 {
		t.Fatal("a nil ledger counts nothing")
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
