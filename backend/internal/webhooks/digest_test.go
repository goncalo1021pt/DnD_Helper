package webhooks

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestDiscordDigestOneEmbedPerTable(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	bodies, carries, err := discordDigests([]DigestTable{
		{ID: a, Name: "Sunless Citadel", Lines: []string{"one", "two"}},
		{ID: b, Name: "Barovia", Lines: []string{"three"}},
	}, "https://qb.example")
	if err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 1 || carries[0] != 3 {
		t.Fatalf("bodies = %d, carries = %v", len(bodies), carries)
	}
	var m discordDigestMessage
	if err := json.Unmarshal(bodies[0], &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Embeds) != 2 || m.Embeds[0].Title != "Sunless Citadel" || !strings.Contains(m.Embeds[0].Description, "• two") {
		t.Errorf("embeds = %+v", m.Embeds)
	}
	if m.Embeds[1].URL != "https://qb.example/questboard/campaigns/"+b.String() {
		t.Errorf("url = %q", m.Embeds[1].URL)
	}
	if len(m.AllowedMentions.Parse) != 0 {
		t.Error("mentions must stay off: a line is somebody's own text")
	}
}

func TestDiscordDigestSplitsPastTenTables(t *testing.T) {
	var tables []DigestTable
	for i := 0; i < 12; i++ {
		tables = append(tables, DigestTable{ID: uuid.New(), Name: fmt.Sprintf("T%d", i), Lines: []string{"x"}})
	}
	bodies, carries, err := discordDigests(tables, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 2 || carries[0] != 10 || carries[1] != 2 {
		t.Errorf("bodies = %d, carries = %v", len(bodies), carries)
	}
}

func TestDiscordDigestCutsAndCounts(t *testing.T) {
	long := strings.Repeat("w", 400)
	var lines []string
	for i := 0; i < 30; i++ {
		lines = append(lines, long)
	}
	bodies, carries, err := discordDigests([]DigestTable{{ID: uuid.New(), Name: "Busy", Lines: lines}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if carries[0] != 30 {
		t.Errorf("carries = %v, want 30: the delivery counts what was held, not what fits", carries)
	}
	var m discordDigestMessage
	_ = json.Unmarshal(bodies[0], &m)
	d := m.Embeds[0].Description
	if len(d) > 4096 || !strings.Contains(d, "more.") {
		t.Errorf("a description over Discord's limit, or no count of what was left out: %d chars", len(d))
	}
}
