package http

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
The Go half of the shared rules contract (#112), for the rules that live in
this package.

Several 5e rules are implemented twice — once here so the server can enforce
them, once in TypeScript so the wizard can answer without a round-trip on every
click. The mirroring is deliberate. What was missing is anything that notices
when the two drift, and drift is silent: the symptom is a wizard that lets a
player through and a server that then says no, twenty minutes into building a
hero, or a Level up button that offers a press it knows will fail.

Its twins are frontend/src/lib/{abilities,species,progression}.test.ts, reading
these same three files. Neither side can move alone any more — changing a rule
here without changing the fixture fails in `go test`, and changing the fixture
without changing the client fails in vitest.

(backend/internal/rules/spellslots_test.go is the same arrangement for spell
slots, which came first.)
*/

func loadFixture(t *testing.T, name string, into interface{}) {
	t.Helper()
	path := filepath.Join("..", "..", "..", "fixtures", "rules", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
}

// --- ability modifiers ------------------------------------------------------

func TestAbilityModMatchesTheSharedFixture(t *testing.T) {
	var doc struct {
		Cases []struct {
			Score int `json:"score"`
			Mod   int `json:"mod"`
		} `json:"cases"`
	}
	loadFixture(t, "ability-mods.json", &doc)
	if len(doc.Cases) != 30 {
		t.Fatalf("fixture has %d cases; want every score 1..30", len(doc.Cases))
	}
	for _, c := range doc.Cases {
		if got := abilityMod(c.Score); got != c.Mod {
			t.Errorf("abilityMod(%d) = %d, the table says %d", c.Score, got, c.Mod)
		}
	}
}

// --- species choices --------------------------------------------------------

type speciesCase struct {
	Name     string              `json:"name"`
	Choices  []speciesChoice     `json:"choices"`
	Picks    map[string][]string `json:"picks"`
	Complete bool                `json:"complete"`
	Skills   []string            `json:"skills"`
	Feats    []string            `json:"feats"`
}

func TestSpeciesChoicesMatchTheSharedFixture(t *testing.T) {
	var doc struct {
		Cases []speciesCase `json:"cases"`
	}
	loadFixture(t, "species-choices.json", &doc)
	if len(doc.Cases) == 0 {
		t.Fatal("fixture has no cases")
	}

	for _, c := range doc.Cases {
		out, errMsg := resolveSpeciesChoices(
			speciesRules{Choices: c.Choices}, "Testfolk", c.Picks, nil,
		)

		// "Complete" on the client is "accepted" on the server: the wizard arms
		// its button exactly when the forge would take the hero.
		if c.Complete && errMsg != "" {
			t.Errorf("%s: fixture says the picks are complete, server refused them: %s", c.Name, errMsg)
			continue
		}
		if !c.Complete {
			if errMsg == "" {
				t.Errorf("%s: fixture says incomplete, server accepted the picks", c.Name)
			}
			continue // an incomplete hero grants nothing; nothing to compare
		}

		if !sameStrings(out.Skills, c.Skills) {
			t.Errorf("%s: skills = %v, fixture says %v", c.Name, out.Skills, c.Skills)
		}
		if !sameStrings(out.Feats, c.Feats) {
			t.Errorf("%s: feats = %v, fixture says %v", c.Name, out.Feats, c.Feats)
		}
	}
}

// sameStrings compares in order — the picks land on the sheet in the order the
// species asks for them, and nil and empty are the same "granted nothing".
func sameStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// --- armour class -----------------------------------------------------------

func TestArmorClassMatchesTheSharedFixture(t *testing.T) {
	var doc struct {
		Cases []struct {
			Name      string            `json:"name"`
			Level     int               `json:"level"`
			Abilities map[string]int    `json:"abilities"`
			Sources   []json.RawMessage `json:"sources"`
			Items     []struct {
				Equipped bool            `json:"equipped"`
				Attuned  bool            `json:"attuned"`
				Data     json.RawMessage `json:"data"`
			} `json:"items"`
			AC int `json:"ac"`
		} `json:"cases"`
	}
	loadFixture(t, "armor-class.json", &doc)
	if len(doc.Cases) == 0 {
		t.Fatal("fixture has no cases")
	}
	for _, c := range doc.Cases {
		var features []heroFeature
		for _, src := range c.Sources {
			features = append(features, earnedFeatures(src, c.Level)...)
		}
		items := make([]wornItem, 0, len(c.Items))
		for _, it := range c.Items {
			items = append(items, wornItem{Equipped: it.Equipped, Attuned: it.Attuned, Data: it.Data})
		}
		if got := armorClass(items, c.Abilities, features); got != c.AC {
			t.Errorf("%s: AC = %d, fixture says %d", c.Name, got, c.AC)
		}
	}
}

// --- level-up gates ---------------------------------------------------------

func TestLevelUpGatesMatchTheSharedFixture(t *testing.T) {
	var doc struct {
		Cases []struct {
			Name          string `json:"name"`
			Level         int    `json:"level"`
			PendingLevels int    `json:"pendingLevels"`
			Progression   string `json:"progression"`
			MaxLevel      *int16 `json:"maxLevel"`
			Hold          string `json:"hold"` // absent/null decodes to ""
		} `json:"cases"`
	}
	loadFixture(t, "level-up-gates.json", &doc)
	if len(doc.Cases) == 0 {
		t.Fatal("fixture has no cases")
	}
	for _, c := range doc.Cases {
		got := levelUpHold(c.Level, c.PendingLevels, db.ProgressionMode(c.Progression), c.MaxLevel)
		if got != c.Hold {
			t.Errorf("%s: hold = %q, fixture says %q", c.Name, got, c.Hold)
		}
	}
}
