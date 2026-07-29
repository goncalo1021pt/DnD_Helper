package http

import (
	"encoding/json"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

func rule(when, count string) *spellChangeRule {
	return &spellChangeRule{When: when, Count: json.RawMessage(count)}
}

func TestSpellChangeAllowance(t *testing.T) {
	cases := []struct {
		name    string
		rule    *spellChangeRule
		trigger string
		want    int
	}{
		{"cleric re-prepares freely on a long rest", rule("long-rest", `"any"`), "long-rest", unlimitedSwaps},
		{"cleric can't re-prepare by levelling", rule("long-rest", `"any"`), "level-up", 0},
		{"paladin swaps one on a long rest", rule("long-rest", `1`), "long-rest", 1},
		{"bard swaps one on level-up", rule("level-up", `1`), "level-up", 1},
		{"bard can't swap on a long rest", rule("level-up", `1`), "long-rest", 0},
		{"absent rule allows nothing", nil, "long-rest", 0},
		{"missing count means one", &spellChangeRule{When: "long-rest"}, "long-rest", 1},
		{"a nonsense count allows nothing", rule("long-rest", `"often"`), "long-rest", 0},
	}
	for _, c := range cases {
		if got := c.rule.allowance(c.trigger); got != c.want {
			t.Errorf("%s: allowance(%q) = %d, want %d", c.name, c.trigger, got, c.want)
		}
	}
}

func TestSpellChangesForFallsBackForOlderData(t *testing.T) {
	// A homebrew or imported caster predating the field still has to be able to
	// re-prepare, or an Artificer from a pack could never change a spell.
	got := spellChangesFor(castingRules{Spellcaster: "full"})
	if got.Prepared.allowance("long-rest") != unlimitedSwaps {
		t.Error("a caster without the field should re-prepare freely on a Long Rest")
	}
	if got.Cantrips.allowance("long-rest") != 0 || got.Cantrips.allowance("level-up") != 0 {
		t.Error("the fallback should not invent a cantrip swap")
	}
	// An explicit rule always wins.
	explicit := castingRules{
		Spellcaster:  "full",
		SpellChanges: &spellChangeRules{Prepared: rule("level-up", `1`)},
	}
	if spellChangesFor(explicit).Prepared.allowance("long-rest") != 0 {
		t.Error("an explicit level-up rule must not be overridden by the fallback")
	}
}

// The shipped class data must agree with the rules text it ships beside: every
// caster carries a rule, no non-caster does, and each trigger is one we gate on.
func TestSeededClassesCarrySpellChangeRules(t *testing.T) {
	raw, err := rules.SRDFile("srd/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("no classes seeded")
	}
	// From the 2024 "Changing Your Prepared Spells" paragraphs.
	wantPrepared := map[string]struct {
		when  string
		count int
	}{
		"Bard":     {"level-up", 1},
		"Cleric":   {"long-rest", unlimitedSwaps},
		"Druid":    {"long-rest", unlimitedSwaps},
		"Paladin":  {"long-rest", 1},
		"Ranger":   {"long-rest", 1},
		"Sorcerer": {"level-up", 1},
		"Warlock":  {"level-up", 1},
		"Wizard":   {"long-rest", unlimitedSwaps},
	}
	seen := map[string]bool{}
	for _, e := range entries {
		var cr castingRules
		if err := json.Unmarshal(e.Data, &cr); err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		want, isCaster := wantPrepared[e.Name]
		if !isCaster {
			if cr.Spellcaster != "" {
				t.Errorf("%s casts spells but is not in the expected set", e.Name)
			}
			if cr.SpellChanges != nil {
				t.Errorf("%s is not a caster but carries a spellChanges rule", e.Name)
			}
			continue
		}
		seen[e.Name] = true
		if cr.SpellChanges == nil {
			t.Errorf("%s has no spellChanges rule", e.Name)
			continue
		}
		if got := cr.SpellChanges.Prepared.allowance(want.when); got != want.count {
			t.Errorf("%s prepared: allowance(%q) = %d, want %d", e.Name, want.when, got, want.count)
		}
		// The other trigger must grant nothing — that split is the whole point.
		other := "level-up"
		if want.when == "level-up" {
			other = "long-rest"
		}
		if got := cr.SpellChanges.Prepared.allowance(other); got != 0 {
			t.Errorf("%s prepared: allowance(%q) = %d, want 0", e.Name, other, got)
		}
	}
	for name := range wantPrepared {
		if !seen[name] {
			t.Errorf("%s was not found in the seeded classes", name)
		}
	}
}

// Only the Wizard trades a cantrip on a Long Rest; everyone else waits for a level.
func TestOnlyWizardSwapsCantripsOnALongRest(t *testing.T) {
	raw, err := rules.SRDFile("srd/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		var cr castingRules
		_ = json.Unmarshal(e.Data, &cr)
		if cr.SpellChanges == nil {
			continue
		}
		got := cr.SpellChanges.Cantrips.allowance("long-rest")
		if e.Name == "Wizard" && got != 1 {
			t.Errorf("Wizard should swap one cantrip on a Long Rest, got %d", got)
		}
		if e.Name != "Wizard" && got != 0 {
			t.Errorf("%s should not swap cantrips on a Long Rest, got %d", e.Name, got)
		}
	}
}
