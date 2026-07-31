package rules

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/*
The Go half of the shared rules contract (#112).

Several 5e rules are implemented twice — once here so the server can enforce
them, once in TypeScript so the wizard can validate before submitting. The
mirroring is a reasonable choice; the alternative is a round-trip on every
click. What was missing is anything that notices when the two drift, and drift
is silent: the symptom is a UI that offers a spell level the server then
refuses, or hides one the player is owed, and nobody finds out until mid-session.

So fixtures/rules/spell-slots.json holds the tables, and both engines assert
against that same file. Neither side can move alone any more — changing this
package without changing the fixture fails here, and changing the fixture
without changing lib/spellcasting.ts fails in vitest.
*/

type slotCase struct {
	Kind          string `json:"kind"`
	Level         int    `json:"level"`
	Slots         []int  `json:"slots"`
	MaxSpellLevel int    `json:"maxSpellLevel"`
}

func loadSlotCases(t *testing.T) []slotCase {
	t.Helper()
	path := filepath.Join("..", "..", "..", "fixtures", "rules", "spell-slots.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var doc struct {
		Cases []slotCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(doc.Cases) == 0 {
		t.Fatalf("%s has no cases", path)
	}
	return doc.Cases
}

func TestSlotTableMatchesTheSharedFixture(t *testing.T) {
	for _, c := range loadSlotCases(t) {
		got := SlotTable(c.Kind, c.Level)
		for i, want := range c.Slots {
			if got[i] != want {
				t.Errorf("%s level %d: spell level %d has %d slots, fixture says %d",
					c.Kind, c.Level, i+1, got[i], want)
			}
		}
	}
}

func TestMaxSpellLevelMatchesTheSharedFixture(t *testing.T) {
	for _, c := range loadSlotCases(t) {
		if got := MaxSpellLevel(c.Kind, c.Level); got != c.MaxSpellLevel {
			t.Errorf("%s level %d: MaxSpellLevel = %d, fixture says %d",
				c.Kind, c.Level, got, c.MaxSpellLevel)
		}
	}
}

// A character level outside 1..20 is clamped rather than panicking on the
// table index — worth pinning, because a homebrew class with a silly level
// reaches this from the wizard.
func TestSlotTableClampsLevelsOutsideTheTable(t *testing.T) {
	if SlotTable("full", 0) != SlotTable("full", 1) {
		t.Error("level 0 should be treated as level 1")
	}
	if SlotTable("full", 99) != SlotTable("full", 20) {
		t.Error("level 99 should be treated as level 20")
	}
	if SlotTable("not-a-caster", 5) != [9]int{} {
		t.Error("an unknown caster kind should get no slots at all")
	}
}
