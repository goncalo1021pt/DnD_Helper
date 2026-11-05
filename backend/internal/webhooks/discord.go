package webhooks

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

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

// Discord's own limits for a message: ten embeds, and a description of
// 4096 characters. A digest stays under both and says how many it left out.
const (
	maxEmbeds     = 10
	maxEmbedChars = 3800
)

// DigestTable is one table's lines in a daily digest.
type DigestTable struct {
	ID    uuid.UUID
	Name  string
	Lines []string
}

type discordEmbed struct {
	Title       string `json:"title"`
	URL         string `json:"url,omitempty"`
	Description string `json:"description"`
}

type discordDigestMessage struct {
	Username        string          `json:"username"`
	Embeds          []discordEmbed  `json:"embeds"`
	AllowedMentions allowedMentions `json:"allowed_mentions"`
}

// discordDigests turns a day's lines into messages: one embed per table, at
// most ten to a message, a table's description cut with a count of what it
// left out. Each message is returned with how many events it carries.
func discordDigests(tables []DigestTable, baseURL string) (bodies [][]byte, carries []int, err error) {
	for start := 0; start < len(tables); start += maxEmbeds {
		end := min(start+maxEmbeds, len(tables))
		msg := discordDigestMessage{Username: "Quest Board", AllowedMentions: allowedMentions{Parse: []string{}}}
		n := 0
		for _, t := range tables[start:end] {
			var b strings.Builder
			shown := 0
			for _, l := range t.Lines {
				if b.Len()+len(l)+3 > maxEmbedChars {
					break
				}
				b.WriteString("• " + l + "\n")
				shown++
			}
			if left := len(t.Lines) - shown; left > 0 {
				fmt.Fprintf(&b, "…and %d more.", left)
			}
			e := discordEmbed{Title: t.Name, Description: strings.TrimRight(b.String(), "\n")}
			if baseURL != "" {
				e.URL = tableURL(baseURL, t.ID)
			}
			msg.Embeds = append(msg.Embeds, e)
			n += len(t.Lines)
		}
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		if err = enc.Encode(msg); err != nil {
			return nil, nil, err
		}
		bodies = append(bodies, bytes.TrimRight(buf.Bytes(), "\n"))
		carries = append(carries, n)
	}
	return bodies, carries, nil
}

// discordBody says what happened in one line, with Discord's own timestamp
// tag where a time is mentioned — it renders in each reader's zone — and a
// link to the table, wrapped so Discord does not unfurl it into a card.
func discordBody(env Envelope, baseURL string) ([]byte, error) {
	line := discordLine(env)
	if env.Campaign != nil && baseURL != "" {
		line += "\n<" + tableURL(baseURL, env.Campaign.ID) + ">"
	}
	return marshalDiscord(discordMessage{Content: line, Username: "Quest Board", AllowedMentions: allowedMentions{Parse: []string{}}})
}

func tableURL(baseURL string, id uuid.UUID) string {
	return strings.TrimRight(baseURL, "/") + "/questboard/campaigns/" + id.String()
}

// discordLine is one event said in a line, with Discord's timestamp tag where
// a time is mentioned. A digest holds these; an immediate message adds a link.
func discordLine(env Envelope) string {
	h := events.Happening{Name: events.Name(env.Name), Payload: events.AsMap(env.Payload)}
	if env.Campaign != nil {
		h.Campaign = env.Campaign.Name
	}
	if env.Actor != nil {
		h.Actor = env.Actor.Name
	}
	return events.Describe(h, func(t time.Time) string { return fmt.Sprintf("<t:%d:F>", t.Unix()) })
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
