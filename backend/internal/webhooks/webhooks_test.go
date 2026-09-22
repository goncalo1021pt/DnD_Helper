package webhooks

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
)

func TestValidateURL(t *testing.T) {
	strict, loose := Guard{}, Guard{Permissive: true}
	ok := []string{"https://example.com/hook", "https://hooks.example.com:8443/a/b?c=d"}
	for _, u := range ok {
		if err := strict.ValidateURL(u); err != nil {
			t.Errorf("%s should pass strict: %v", u, err)
		}
	}
	refused := map[string]string{
		"http://example.com/hook":         "https",
		"ftp://example.com/hook":          "https",
		"example.com/hook":                "absolute",
		"":                                "absolute",
		"https://user:pw@example.com/":    "credentials",
		"https://127.0.0.1/":              "private",
		"https://10.1.2.3/":               "private",
		"https://192.168.1.5:8006/":       "private",
		"https://172.16.0.1/":             "private",
		"https://169.254.169.254/latest/": "private",
		"https://100.64.0.1/":             "private",
		"https://[::1]/":                  "private",
		"https://localhost/":              "private",
		"https://pve.local/":              "private",
		"https://app.internal/":           "private",
	}
	for u, want := range refused {
		err := strict.ValidateURL(u)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q should be refused for %q, got %v", u, want, err)
		}
	}
	// Development lets the e2e receiver on the docker host through.
	for _, u := range []string{"http://host.docker.internal:8099/hook", "http://127.0.0.1:8099/hook", "http://172.18.0.1/"} {
		if err := loose.ValidateURL(u); err != nil {
			t.Errorf("%s should pass permissive: %v", u, err)
		}
	}
	if err := loose.ValidateURL("https://user:pw@example.com/"); err == nil {
		t.Error("credentials in a URL are refused even in development")
	}
}

// The dial-time check is what stands against a name that resolves somewhere
// private — checked on the resolved address, after DNS.
func TestDialRefusesPrivateAddresses(t *testing.T) {
	strict := Guard{}
	for _, addr := range []string{"127.0.0.1:80", "10.0.0.1:443", "[::1]:443", "169.254.169.254:80"} {
		if _, err := strict.dial(context.Background(), "tcp", addr); err == nil || !strings.Contains(err.Error(), "private") {
			t.Errorf("%s should be refused at the dial, got %v", addr, err)
		}
	}
	// Permissive dials straight through — to a closed local port, which fails
	// for the ordinary reason rather than the guard's.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	if _, err := (Guard{Permissive: true}).dial(context.Background(), "tcp", addr); err != nil && strings.Contains(err.Error(), "private") {
		t.Errorf("permissive must not apply the guard, got %v", err)
	}
}

func TestSignAndVerify(t *testing.T) {
	secret := NewSecret()
	if !strings.HasPrefix(secret, SecretPrefix) || len(secret) != len(SecretPrefix)+43 {
		t.Fatalf("secret shape: %q", secret)
	}
	body := []byte(`{"name":"quest.posted"}`)
	sig := Sign(secret, 1_800_000_000, body)
	if !strings.HasPrefix(sig, "sha256=") || len(sig) != len("sha256=")+64 {
		t.Fatalf("signature shape: %q", sig)
	}
	if !Verify(secret, 1_800_000_000, body, sig) {
		t.Fatal("a signature verifies with the secret, timestamp and body it was made from")
	}
	if Verify(secret, 1_800_000_001, body, sig) {
		t.Fatal("the timestamp is inside the signed text: a replay with a fresh one fails")
	}
	if Verify(secret, 1_800_000_000, []byte(`{"name":"quest.claimed"}`), sig) {
		t.Fatal("a changed body fails")
	}
	if Verify(NewSecret(), 1_800_000_000, body, sig) {
		t.Fatal("another secret fails")
	}
}

func TestHears(t *testing.T) {
	table, other := uuid.New(), uuid.New()
	base := db.Webhook{}
	if !Hears(base, table, events.QuestPosted) {
		t.Fatal("no filters: hears everything")
	}
	confined := base
	confined.CampaignID = pgtype.UUID{Bytes: table, Valid: true}
	if !Hears(confined, table, events.QuestPosted) || Hears(confined, other, events.QuestPosted) {
		t.Fatal("confined to one table")
	}
	picky := base
	picky.Events = []string{"quest.posted", "session.moved"}
	if !Hears(picky, table, events.SessionMoved) || Hears(picky, table, events.QuestClaimed) {
		t.Fatal("only the names it picked")
	}
	// Born of a token holding heroes:read alone: hero events only, whatever
	// it asked for.
	capped := base
	capped.Scopes = []string{"heroes:read", "webhooks:write"}
	if !Hears(capped, table, events.HeroXPAwarded) || Hears(capped, table, events.QuestPosted) {
		t.Fatal("a token-born hook hears no more than the token could read")
	}
	dm := base
	dm.Scopes = []string{"campaigns:run"}
	if !Hears(dm, table, events.QuestPosted) || Hears(dm, table, events.HeroLevelled) {
		t.Fatal("campaigns:run implies campaigns:read, and says nothing about heroes")
	}
	session := base
	session.Scopes = nil
	if !Hears(session, table, events.HeroLevelled) {
		t.Fatal("a browser-born hook has no cap")
	}
}

func TestReadScopeOf(t *testing.T) {
	for _, n := range events.All {
		got := ReadScopeOf(n)
		if got != "campaigns:read" && got != "heroes:read" {
			t.Fatalf("%s maps to %s, which is not a read scope", n, got)
		}
	}
}

// A Discord body is a content line with mentions switched off, and a
// ping says so in words Discord will render.
func TestDiscordBody(t *testing.T) {
	cid := uuid.New()
	env := Envelope{
		ID: uuid.New(), Name: "quest.posted", Campaign: &EnvelopeCampaign{ID: cid, Name: "Sunless"},
		Payload: map[string]any{"title": "Rats @everyone", "difficulty": "easy"},
	}
	body, err := discordBody(env, "https://dnd.example/")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}
	content, _ := m["content"].(string)
	if !strings.Contains(content, "Rats @everyone") || !strings.Contains(content, "Sunless") {
		t.Errorf("content: %q", content)
	}
	if !strings.Contains(content, "<https://dnd.example/questboard/campaigns/"+cid.String()+">") {
		t.Errorf("the link is wrapped so it does not unfurl: %q", content)
	}
	am, _ := m["allowed_mentions"].(map[string]any)
	if parse, _ := am["parse"].([]any); parse == nil || len(parse) != 0 {
		t.Errorf("mentions must be off: %v", m["allowed_mentions"])
	}
	// A time renders as Discord's own tag, in the reader's zone.
	env.Name, env.Payload = "session.scheduled", map[string]any{"at": "2026-10-03T19:00:00Z"}
	body, _ = discordBody(env, "")
	if !strings.Contains(string(body), "<t:1791054000:F>") {
		t.Errorf("session time should be a Discord timestamp tag: %s", body)
	}
	ping, _ := discordPing()
	if !strings.Contains(string(ping), `"content":"Quest Board can reach this channel."`) {
		t.Errorf("ping: %s", ping)
	}
}
