package webhooks

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/goncalo1021pt/questboard/backend/internal/events"
)

// Formats a hook may receive (#316). Questboard is the signed envelope of
// #295; Discord is the body a Discord incoming webhook renders, and it will
// render nothing else — the RUNBOOK already warned about that for the
// uptime monitor.
const (
	FormatQuestboard = "questboard"
	FormatDiscord    = "discord"
)

// discordMessage is the shape Discord's incoming webhooks accept. Mentions
// are switched off wholesale: a quest title is somebody's own text, and it
// must not be able to ping @everyone in a channel it did not make.
type discordMessage struct {
	Content         string          `json:"content"`
	Username        string          `json:"username"`
	AllowedMentions allowedMentions `json:"allowed_mentions"`
}

type allowedMentions struct {
	Parse []string `json:"parse"`
}

// discordBody says what happened in one line, with Discord's own timestamp
// tag where a time is mentioned — it renders in each reader's zone — and a
// link to the table, wrapped so Discord does not unfurl it into a card.
func discordBody(env Envelope, baseURL string) ([]byte, error) {
	h := events.Happening{Name: events.Name(env.Name), Payload: events.AsMap(env.Payload)}
	if env.Campaign != nil {
		h.Campaign = env.Campaign.Name
	}
	if env.Actor != nil {
		h.Actor = env.Actor.Name
	}
	line := events.Describe(h, func(t time.Time) string { return fmt.Sprintf("<t:%d:F>", t.Unix()) })
	if env.Campaign != nil && baseURL != "" {
		line += "\n<" + strings.TrimRight(baseURL, "/") + "/questboard/campaigns/" + env.Campaign.ID.String() + ">"
	}
	return marshalDiscord(discordMessage{Content: line, Username: "Quest Board", AllowedMentions: allowedMentions{Parse: []string{}}})
}

// discordPing is the test message.
func discordPing() ([]byte, error) {
	return marshalDiscord(discordMessage{
		Content: "Quest Board can reach this channel.", Username: "Quest Board", AllowedMentions: allowedMentions{Parse: []string{}},
	})
}

// marshalDiscord keeps the angle brackets of a timestamp tag and a wrapped
// link as they are: Discord reads either spelling, but the delivery log is
// read by a person.
func marshalDiscord(m discordMessage) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(m); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
