package events

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Happening is an event as a reader needs it said: the names beside the ids.
// The payload is the *EventPayload shape as a map, since a line of prose
// reads fields by name and must not care which Go type carried them.
type Happening struct {
	Name     Name
	Campaign string         // the table's name
	Actor    string         // who did it; empty when nobody in particular
	Payload  map[string]any // the event's payload, by field name
}

// AsMap flattens a payload — one of the api.*EventPayload structs, or a map
// already — into the map Describe reads.
func AsMap(payload any) map[string]any {
	if m, ok := payload.(map[string]any); ok {
		return m
	}
	out := map[string]any{}
	if payload == nil {
		return out
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

// Describe says what happened in one line, the same line whichever door it
// leaves by — an email's subject, a Discord message — so a person reading
// both recognises one event. when formats a time the way the door wants it:
// Discord has a tag that renders in the reader's own zone, an email does not.
func Describe(h Happening, when func(time.Time) string) string {
	p := h.Payload
	str := func(k string) string {
		v, _ := p[k].(string)
		return v
	}
	num := func(k string) int {
		switch v := p[k].(type) {
		case float64:
			return int(v)
		case int:
			return v
		}
		return 0
	}
	named := func(k, fallback string) string {
		if m, ok := p[k].(map[string]any); ok {
			if n, _ := m["name"].(string); n != "" {
				return n
			}
		}
		return fallback
	}
	at := func(k string) string {
		s := str(k)
		t, err := time.Parse(time.RFC3339, s)
		if err != nil || when == nil {
			return s
		}
		return when(t)
	}
	c := h.Campaign
	if c == "" {
		c = "your table"
	}
	switch h.Name {
	case QuestPosted:
		return fmt.Sprintf("A notice is on the board at %s: “%s” (%s).", c, str("title"), str("difficulty"))
	case QuestClaimed:
		return fmt.Sprintf("%s took up “%s” at %s.", named("claimedBy", "Somebody"), str("title"), c)
	case QuestCompleted:
		return fmt.Sprintf("“%s” is done at %s.", str("title"), c)
	case HandoutGiven:
		line := fmt.Sprintf("A handout at %s: “%s”.", c, str("title"))
		if cap := strings.TrimSpace(str("caption")); cap != "" {
			line += " " + cap
		}
		return line
	case SessionScheduled:
		return fmt.Sprintf("%s gathers next on %s.", c, at("at"))
	case SessionMoved:
		if str("previousAt") != "" {
			return fmt.Sprintf("The next gathering at %s moved to %s (it was %s).", c, at("at"), at("previousAt"))
		}
		return fmt.Sprintf("The next gathering at %s moved to %s.", c, at("at"))
	case HeroLevelled:
		return fmt.Sprintf("%s rises to level %d (%s) at %s.", str("heroName"), num("level"), str("className"), c)
	case HeroXPAwarded:
		amount := num("amount")
		verb := "gains"
		if amount < 0 {
			verb, amount = "loses", -amount
		}
		line := fmt.Sprintf("%s %s %d XP at %s (%d in all).", str("heroName"), verb, amount, c, num("total"))
		if r := strings.TrimSpace(str("reason")); r != "" {
			line += " " + r
		}
		return line
	case EncounterStarted:
		return fmt.Sprintf("A fight begins at %s: %s.", c, str("name"))
	case EncounterEnded:
		return fmt.Sprintf("%s stands down at %s.", str("name"), c)
	case ChronicleWritten:
		author := strings.TrimSpace(str("author"))
		if author == "" {
			author = "Somebody"
		}
		return fmt.Sprintf("%s writes in the chronicle at %s: %s", author, c, str("excerpt"))
	case MemberJoined:
		if str("role") == "dm" {
			return fmt.Sprintf("%s joins %s behind the screen.", str("name"), c)
		}
		return fmt.Sprintf("%s takes a seat at %s.", str("name"), c)
	case SeatRequested:
		return fmt.Sprintf("%s asks for a seat at %s for %s.", str("userName"), c, str("heroName"))
	}
	return fmt.Sprintf("%s at %s.", h.Name, c)
}
