package http

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

/*
The Rulebook's seed, held to the door it would have to pass as a pack (#199).

The entries are the keywords the rest of the app leans on — a chip that opens
an empty popover is worse than no chip, so the vocabulary the tracker and the
armory actually use is cross-checked here, not just the JSON's shape.
*/

type seededRule struct {
	Name    string                 `json:"name"`
	Summary string                 `json:"summary"`
	Data    map[string]interface{} `json:"data"`
}

func seededRules(t *testing.T) []seededRule {
	t.Helper()
	raw, err := rules.SRDFile("srd/rules.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []seededRule
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestSeededRulesAreLegalContent(t *testing.T) {
	entries := seededRules(t)
	if len(entries) < 50 {
		t.Fatalf("expected the rules glossary, got %d entries", len(entries))
	}
	categories := map[string]bool{
		"weapon-property": true, "mastery": true, "condition": true,
		"action": true, "glossary": true,
	}
	seen := map[string]bool{}
	for _, e := range entries {
		if msg := validateContentData(db.ContentKindRule, e.Data); msg != "" {
			t.Errorf("%s: %s", e.Name, msg)
		}
		lower := strings.ToLower(e.Name)
		if seen[lower] {
			t.Errorf("%s: duplicate entry", e.Name)
		}
		seen[lower] = true
		if strings.TrimSpace(e.Summary) == "" {
			t.Errorf("%s: a keyword popover leads with the summary — it can't be empty", e.Name)
		}
		cat, _ := e.Data["category"].(string)
		if !categories[cat] {
			t.Errorf("%s: unknown category %q", e.Name, cat)
		}
		desc, _ := e.Data["description"].(string)
		if strings.TrimSpace(desc) == "" {
			t.Errorf("%s: no description", e.Name)
		}
		// The reader knows paragraphs, bold and italics — never lists.
		for _, line := range strings.Split(desc, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
				t.Errorf("%s: list marker in description: %q", e.Name, trimmed)
			}
		}
		for _, marker := range []string{"**", "_"} {
			if strings.Count(desc, marker)%2 != 0 {
				t.Errorf("%s: unbalanced %q in description", e.Name, marker)
			}
		}
	}
}

// Every condition the tracker can pin on a combatant must open a rule entry —
// Concentrating is the one tracker chip that is not a book condition, and the
// client maps it to Concentration (lib/rulebook.ts mirrors this).
func TestTrackerConditionsHaveRuleEntries(t *testing.T) {
	entries := seededRules(t)
	byName := map[string]bool{}
	for _, e := range entries {
		byName[strings.ToLower(e.Name)] = true
	}
	for _, name := range conditionNames {
		want := name
		if name == "Concentrating" {
			want = "Concentration"
		}
		if !byName[strings.ToLower(want)] {
			t.Errorf("tracker condition %q has no rule entry %q", name, want)
		}
	}
}
