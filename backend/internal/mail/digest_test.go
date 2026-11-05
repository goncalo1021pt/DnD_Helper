package mail

import (
	"fmt"
	"strings"
	"testing"
)

func TestDigestOneTable(t *testing.T) {
	m := Digest(DigestMail{
		Tables:   []DigestTable{{Name: "Sunless Citadel", Link: "https://x/t", Lines: []string{"Mira wrote: <b>hi</b>", "Brann took up a quest."}}},
		Unsub:    "https://x/u",
		OneClick: "https://x/api/u",
	})
	if m.Subject != "What happened at Sunless Citadel" {
		t.Errorf("subject = %q", m.Subject)
	}
	if strings.Contains(m.HTML, "<b>hi</b>") || !strings.Contains(m.HTML, "&lt;b&gt;hi&lt;/b&gt;") {
		t.Error("a line is somebody's text and must be escaped")
	}
	if !strings.Contains(m.Text, "- Brann took up a quest.") || !strings.Contains(m.Text, "https://x/u") {
		t.Errorf("text = %q", m.Text)
	}
	if m.Headers["List-Unsubscribe"] != "<https://x/api/u>" {
		t.Error("the one-click header is missing")
	}
}

func TestDigestManyTablesAndCap(t *testing.T) {
	var lines []string
	for i := 0; i < MaxDigestLines+5; i++ {
		lines = append(lines, fmt.Sprintf("line %d", i))
	}
	m := Digest(DigestMail{
		Tables: []DigestTable{{Name: "A", Lines: lines}, {Name: "B", Lines: []string{"one"}}},
		Link:   "https://x/",
	})
	if m.Subject != "What happened at your tables" {
		t.Errorf("subject = %q", m.Subject)
	}
	if !strings.Contains(m.Text, "...and 5 more.") || strings.Contains(m.Text, fmt.Sprintf("line %d", MaxDigestLines)) {
		t.Errorf("the cap did not hold: %q", m.Text)
	}
}
