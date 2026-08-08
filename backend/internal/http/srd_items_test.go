package http

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

/*
The armory's seed, held to the door it would have to pass as a pack (#189).

Most of the file is generated (scripts/gen-srd-items.py), which is exactly why
it is tested: a mapping bug writes five hundred plausible-looking entries, and
nothing else between the generator and a player's sheet would say a word.
*/

func seededItems(t *testing.T) []struct {
	Name string                 `json:"name"`
	Data map[string]interface{} `json:"data"`
} {
	t.Helper()
	raw, err := rules.SRDFile("srd/items.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []struct {
		Name string                 `json:"name"`
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestSeededItemsAreLegalContent(t *testing.T) {
	entries := seededItems(t)
	if len(entries) < 400 {
		t.Fatalf("expected the SRD item chapter, got %d entries", len(entries))
	}
	magic, attunement := 0, 0
	seen := map[string]bool{}
	for _, e := range entries {
		if msg := validateContentData(db.ContentKindItem, e.Data); msg != "" {
			t.Errorf("%s: %s", e.Name, msg)
		}
		lower := strings.ToLower(e.Name)
		if seen[lower] {
			t.Errorf("%s: seeded twice — the upsert key is (kind, name)", e.Name)
		}
		seen[lower] = true
		if r, _ := e.Data["rarity"].(string); strings.TrimSpace(r) != "" {
			magic++
		}
		if e.Data["attunement"] == true {
			attunement++
		}
	}
	if magic < 300 {
		t.Errorf("expected the magic chapter, got %d magic items", magic)
	}
	// The attunement flow needs at least four to prove the cap of three.
	if attunement < 4 {
		t.Errorf("expected attunement items to test the cap with, got %d", attunement)
	}
}

// The forge stocks starting gear by matching equipment-line names against the
// whole armory with fuzzy fallbacks (forge.go). A magic item whose name is
// reachable from a mundane name's transforms would silently hand a level-1
// hero its enchanted twin.
func TestMagicNamesStayOffTheForgePath(t *testing.T) {
	entries := seededItems(t)
	magicNames := map[string]bool{}
	for _, e := range entries {
		if r, _ := e.Data["rarity"].(string); strings.TrimSpace(r) != "" {
			magicNames[strings.ToLower(e.Name)] = true
		}
	}
	for _, e := range entries {
		if r, _ := e.Data["rarity"].(string); strings.TrimSpace(r) != "" {
			continue
		}
		lower := strings.ToLower(e.Name)
		for _, candidate := range []string{
			lower,
			strings.TrimSuffix(lower, " armor"),
			lower + " armor",
			strings.TrimSuffix(lower, "s"),
		} {
			if magicNames[candidate] {
				t.Errorf("mundane %q reaches magic item %q through the forge's name transforms", e.Name, candidate)
			}
		}
	}
}
