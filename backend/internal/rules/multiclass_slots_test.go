package rules

import "testing"

func slotsAt(t *testing.T, got [9]int, want ...int) {
	t.Helper()
	for i, n := range want {
		if got[i] != n {
			t.Errorf("level %d slots = %d; want %d (whole row %v)", i+1, got[i], n, got)
		}
	}
}

/*
The book's worked example, which is the whole rule in one line:

	"if you are a level 4 Ranger / level 3 Sorcerer, you count as a level 5
	character when determining your spell slots … you have four level 1 spell
	slots, three level 2 slots, and two level 3 slots."

Half of four rounded UP is two, plus three Sorcerer levels, is five. Rounding
down would give five as well here — so the case below it is the one that
actually pins the 2024 change.
*/
func TestTheBooksRangerSorcererExample(t *testing.T) {
	classes := []CasterClass{{Kind: "half", Levels: 4}, {Kind: "full", Levels: 3}}

	if got := CasterLevel(classes); got != 5 {
		t.Fatalf("caster level = %d; want 5", got)
	}
	slotsAt(t, MulticlassSlots(classes), 4, 3, 2)
}

// Half-casters round UP in 2024, where 2014 rounded down. A Paladin 1 who
// multiclasses is already caster level 1, not 0.
func TestHalfCasterLevelsRoundUp(t *testing.T) {
	if got := CasterLevel([]CasterClass{{Kind: "half", Levels: 1}}); got != 1 {
		t.Errorf("Paladin 1 counts as caster level %d; want 1 (2024 rounds up)", got)
	}
	if got := CasterLevel([]CasterClass{{Kind: "half", Levels: 3}}); got != 2 {
		t.Errorf("Paladin 3 counts as caster level %d; want 2", got)
	}
	// Paired with a full caster, the rounding is what decides the row.
	classes := []CasterClass{{Kind: "half", Levels: 1}, {Kind: "full", Levels: 1}}
	if got := CasterLevel(classes); got != 2 {
		t.Errorf("Paladin 1 / Wizard 1 = caster level %d; want 2", got)
	}
}

func TestThirdCastersRoundDown(t *testing.T) {
	if got := CasterLevel([]CasterClass{{Kind: "third", Levels: 2}}); got != 0 {
		t.Errorf("an Eldritch Knight 2 contributes %d; want 0", got)
	}
	if got := CasterLevel([]CasterClass{{Kind: "third", Levels: 7}}); got != 2 {
		t.Errorf("an Eldritch Knight 7 contributes %d; want 2", got)
	}
}

/*
A lone third-caster keeps the printed subclass table, which — like the lone
half-caster's — runs ahead of their multiclass contribution: an Eldritch
Knight 7 alone holds 4/2 (full table at ceil(7/3) = 3), but contributes only
floor(7/3) = 2 levels to a shared pool. And before the subclass exists at
level 3 there are no slots at all (#220).
*/
func TestALoneThirdCasterKeepsTheirOwnTable(t *testing.T) {
	if got := SlotTable("third", 2); got != [9]int{} {
		t.Errorf("a Fighter 2 has no subclass yet, so no slots; got %v", got)
	}
	slotsAt(t, MulticlassSlots([]CasterClass{{Kind: "third", Levels: 3}}), 2, 0)
	slotsAt(t, MulticlassSlots([]CasterClass{{Kind: "third", Levels: 7}}), 4, 2, 0)

	// Beside a full caster the shared table takes over: EK 7 / Wizard 2 is
	// caster level 4, whose row is 4/3.
	shared := MulticlassSlots([]CasterClass{{Kind: "third", Levels: 7}, {Kind: "full", Levels: 2}})
	slotsAt(t, shared, 4, 3, 0)
}

// Warlocks are absent from the list that builds the shared pool.
func TestPactLevelsDoNotJoinTheSharedPool(t *testing.T) {
	classes := []CasterClass{{Kind: "pact", Levels: 5}, {Kind: "full", Levels: 3}}

	if got := CasterLevel(classes); got != 3 {
		t.Errorf("caster level = %d; the Warlock's five levels must not count", got)
	}
	if got := PactLevels(classes); got != 5 {
		t.Errorf("pact levels = %d; want 5", got)
	}
}

func TestNonCastingLevelsContributeNothing(t *testing.T) {
	classes := []CasterClass{{Kind: "", Levels: 11}, {Kind: "full", Levels: 2}}
	if got := CasterLevel(classes); got != 2 {
		t.Errorf("caster level = %d; a Fighter's levels are not caster levels", got)
	}
}

/*
"If you multiclass but have the Spellcasting feature from only one class,
follow the rules for that class." For a lone half-caster that matters: their
own table is slower than the shared one at the same level.
*/
func TestALoneHalfCasterKeepsTheirOwnTable(t *testing.T) {
	solo := MulticlassSlots([]CasterClass{{Kind: "half", Levels: 5}})
	// Paladin 5: four level 1 and two level 2 — not the full caster's row.
	slotsAt(t, solo, 4, 2, 0)

	// Add any second casting class and the shared table takes over. Paladin 5
	// (ceil 5/2 = 3) plus Wizard 1 is caster level 4, whose row is 4/3 — one
	// more level 2 slot than the Paladin's own table gives at the same point,
	// which is the whole reason the shared table exists.
	shared := MulticlassSlots([]CasterClass{{Kind: "half", Levels: 5}, {Kind: "full", Levels: 1}})
	slotsAt(t, shared, 4, 3, 0)
}

func TestAWarlockAloneHasNoSharedSlots(t *testing.T) {
	classes := []CasterClass{{Kind: "pact", Levels: 5}}
	if got := MulticlassSlots(classes); got != [9]int{} {
		t.Errorf("pact magic is not the shared pool; got %v", got)
	}
	count, level := PactSlotsFor(PactLevels(classes))
	if count != 2 || level != 3 {
		t.Errorf("Warlock 5 has %d slots at level %d; want 2 at 3", count, level)
	}
}

// The two pools stand side by side: a Warlock 3 / Wizard 3 has pact slots AND
// the shared table's slots, and neither replaces the other.
func TestPactAndSharedPoolsStandTogether(t *testing.T) {
	classes := []CasterClass{{Kind: "pact", Levels: 3}, {Kind: "full", Levels: 3}}

	shared := MulticlassSlots(classes)
	slotsAt(t, shared, 4, 2)
	count, level := PactSlotsFor(PactLevels(classes))
	if count != 2 || level != 2 {
		t.Errorf("Warlock 3 has %d slots at level %d; want 2 at 2", count, level)
	}
}

func TestNoCastingClassesMeansNoSlots(t *testing.T) {
	if got := MulticlassSlots(nil); got != [9]int{} {
		t.Errorf("got %v; want an empty row", got)
	}
	if c, l := PactSlotsFor(0); c != 0 || l != 0 {
		t.Errorf("got %d slots at level %d; want none", c, l)
	}
}
