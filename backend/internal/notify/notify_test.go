package notify

import (
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/events"
)

// The token names its person, and only under the key it was cut with.
func TestUnsubscribeTokenRoundTrip(t *testing.T) {
	s := NewTokens("session-key")
	id := uuid.New()
	tok := s.UnsubscribeToken(id)
	got, ok := s.ParseUnsubscribeToken(tok)
	if !ok || got != id {
		t.Fatalf("round trip: %v %v", got, ok)
	}
	if _, ok := NewTokens("another-key").ParseUnsubscribeToken(tok); ok {
		t.Error("a token cut under one key must not open under another")
	}
	for _, bad := range []string{"", "x", tok[:len(tok)-2], tok + "aa", "!!!"} {
		if _, ok := s.ParseUnsubscribeToken(bad); ok {
			t.Errorf("%q should be refused", bad)
		}
	}
	// Tamper with the id: the mac no longer matches.
	raw := []byte(tok)
	raw[0] ^= 1
	if _, ok := s.ParseUnsubscribeToken(string(raw)); ok {
		t.Error("a tampered token must be refused")
	}
}

// NULL is the defaults; a list is exactly the list; the chronicle is never
// emailed.
func TestWants(t *testing.T) {
	if !Wants(nil, true, events.SessionMoved) || !Wants(nil, true, events.HandoutGiven) {
		t.Error("the defaults cover the next gathering and a handout")
	}
	if Wants(nil, true, events.QuestPosted) {
		t.Error("a quest is not a default")
	}
	if Wants([]string{}, false, events.SessionMoved) {
		t.Error("an empty list is none — the unsubscribe")
	}
	if !Wants([]string{"quest.posted"}, false, events.QuestPosted) || Wants([]string{"quest.posted"}, false, events.SessionMoved) {
		t.Error("a list is exactly the list")
	}
	if Wants([]string{"chronicle.written"}, false, events.ChronicleWritten) || Offered(events.ChronicleWritten) {
		t.Error("the chronicle is not offered by email")
	}
}

func TestWantsDailyIsOptIn(t *testing.T) {
	// A digest is never a default: nobody is subscribed until they chose.
	for _, n := range events.All {
		if WantsDaily(nil, n) || WantsDaily([]string{}, n) {
			t.Errorf("%s is in a digest nobody chose", n)
		}
	}
	if !WantsDaily([]string{"chronicle.written"}, events.ChronicleWritten) {
		t.Error("a chosen name must be wanted")
	}
	if WantsDaily([]string{"chronicle.written"}, events.QuestClaimed) {
		t.Error("only the chosen names")
	}
	// The chronicle is for the digest alone: never immediate, always allowed daily.
	if Offered(events.ChronicleWritten) {
		t.Error("a chronicle line must not be offered as it happens")
	}
}
