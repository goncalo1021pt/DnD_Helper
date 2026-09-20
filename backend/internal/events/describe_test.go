package events

import (
	"strings"
	"testing"
	"time"
)

// One line per event, the names in it and never an id, and the time
// formatted by the door that asked.
func TestDescribeSaysWhatHappened(t *testing.T) {
	when := func(t time.Time) string { return "<" + t.UTC().Format("2006-01-02 15:04") + ">" }
	cases := []struct {
		name    Name
		payload map[string]any
		want    []string
	}{
		{QuestPosted, map[string]any{"questId": "x", "title": "Rats in the cellar", "difficulty": "easy"}, []string{"Rats in the cellar", "easy", "Sunless"}},
		{QuestClaimed, map[string]any{"title": "Rats", "claimedBy": map[string]any{"id": "y", "name": "Nadia"}}, []string{"Nadia took up", "Rats"}},
		{QuestClaimed, map[string]any{"title": "Rats"}, []string{"Somebody took up"}},
		{QuestCompleted, map[string]any{"title": "Rats"}, []string{"“Rats” is done"}},
		{HandoutGiven, map[string]any{"title": "A torn map", "caption": "Found on the body."}, []string{"A torn map", "Found on the body."}},
		{SessionScheduled, map[string]any{"at": "2026-10-03T19:00:00Z"}, []string{"gathers next on <2026-10-03 19:00>"}},
		{SessionMoved, map[string]any{"at": "2026-10-10T19:00:00Z", "previousAt": "2026-10-03T19:00:00Z"}, []string{"moved to <2026-10-10 19:00>", "was <2026-10-03 19:00>"}},
		{HeroLevelled, map[string]any{"heroName": "Brann", "level": float64(5), "className": "Fighter"}, []string{"Brann rises to level 5 (Fighter)"}},
		{HeroXPAwarded, map[string]any{"heroName": "Brann", "amount": float64(-50), "total": float64(900), "reason": "Fled."}, []string{"Brann loses 50 XP", "900 in all", "Fled."}},
		{EncounterStarted, map[string]any{"name": "The bridge"}, []string{"A fight begins", "The bridge"}},
		{EncounterEnded, map[string]any{"name": "The bridge"}, []string{"The bridge stands down"}},
		{ChronicleWritten, map[string]any{"author": "Nadia", "excerpt": "We crossed."}, []string{"Nadia writes in the chronicle", "We crossed."}},
		{MemberJoined, map[string]any{"name": "Rui", "role": "player"}, []string{"Rui takes a seat"}},
		{MemberJoined, map[string]any{"name": "Rui", "role": "dm"}, []string{"Rui joins", "behind the screen"}},
		{SeatRequested, map[string]any{"userName": "Rui", "heroName": "Kes"}, []string{"Rui asks for a seat", "for Kes"}},
	}
	for _, c := range cases {
		got := Describe(Happening{Name: c.name, Campaign: "Sunless Citadel", Payload: c.payload}, when)
		for _, w := range c.want {
			if !strings.Contains(got, w) {
				t.Errorf("%s: %q should contain %q", c.name, got, w)
			}
		}
		if strings.Contains(got, "questId") || strings.Contains(got, "<nil>") {
			t.Errorf("%s: %q leaks a field", c.name, got)
		}
	}
}

// Every name in the catalogue has a line of its own — none falls to the
// generic one.
func TestDescribeCoversTheCatalogue(t *testing.T) {
	for _, n := range All {
		got := Describe(Happening{Name: n, Campaign: "T", Payload: map[string]any{}}, nil)
		if strings.HasPrefix(got, string(n)) {
			t.Errorf("%s has no line of its own: %q", n, got)
		}
	}
}

func TestAsMapFlattensAStruct(t *testing.T) {
	type payload struct {
		Title string `json:"title"`
		Level int    `json:"level"`
	}
	m := AsMap(payload{Title: "x", Level: 3})
	if m["title"] != "x" || m["level"] != float64(3) {
		t.Errorf("got %v", m)
	}
	if len(AsMap(nil)) != 0 {
		t.Error("nil is an empty map")
	}
}
