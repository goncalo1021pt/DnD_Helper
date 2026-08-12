package rules

// Spell-slot progressions and casting fallbacks. These are game math from the
// 2024 rules, not content — content only says WHICH kind of caster a class is
// (data.spellcaster: "full" | "half" | "pact") and may override pick counts
// with a data.spellcasting block.

// Casting describes how many spells a class may know/prepare, indexed by
// character level (index 0 = level 1).
type Casting struct {
	Ability  string `json:"ability"`
	Cantrips [20]int `json:"cantrips"`
	Prepared [20]int `json:"prepared"`
}

// fullSlots[level-1] = slots per spell level 1..9 for full casters.
var fullSlots = [20][9]int{
	{2, 0, 0, 0, 0, 0, 0, 0, 0},
	{3, 0, 0, 0, 0, 0, 0, 0, 0},
	{4, 2, 0, 0, 0, 0, 0, 0, 0},
	{4, 3, 0, 0, 0, 0, 0, 0, 0},
	{4, 3, 2, 0, 0, 0, 0, 0, 0},
	{4, 3, 3, 0, 0, 0, 0, 0, 0},
	{4, 3, 3, 1, 0, 0, 0, 0, 0},
	{4, 3, 3, 2, 0, 0, 0, 0, 0},
	{4, 3, 3, 3, 1, 0, 0, 0, 0},
	{4, 3, 3, 3, 2, 0, 0, 0, 0},
	{4, 3, 3, 3, 2, 1, 0, 0, 0},
	{4, 3, 3, 3, 2, 1, 0, 0, 0},
	{4, 3, 3, 3, 2, 1, 1, 0, 0},
	{4, 3, 3, 3, 2, 1, 1, 0, 0},
	{4, 3, 3, 3, 2, 1, 1, 1, 0},
	{4, 3, 3, 3, 2, 1, 1, 1, 0},
	{4, 3, 3, 3, 2, 1, 1, 1, 1},
	{4, 3, 3, 3, 3, 1, 1, 1, 1},
	{4, 3, 3, 3, 3, 2, 1, 1, 1},
	{4, 3, 3, 3, 3, 2, 2, 1, 1},
}

// halfSlots[level-1]: Paladin/Ranger — 2024 half-casters cast from level 1.
var halfSlots = [20][9]int{
	{2, 0, 0, 0, 0, 0, 0, 0, 0},
	{2, 0, 0, 0, 0, 0, 0, 0, 0},
	{3, 0, 0, 0, 0, 0, 0, 0, 0},
	{3, 0, 0, 0, 0, 0, 0, 0, 0},
	{4, 2, 0, 0, 0, 0, 0, 0, 0},
	{4, 2, 0, 0, 0, 0, 0, 0, 0},
	{4, 3, 0, 0, 0, 0, 0, 0, 0},
	{4, 3, 0, 0, 0, 0, 0, 0, 0},
	{4, 3, 2, 0, 0, 0, 0, 0, 0},
	{4, 3, 2, 0, 0, 0, 0, 0, 0},
	{4, 3, 3, 0, 0, 0, 0, 0, 0},
	{4, 3, 3, 0, 0, 0, 0, 0, 0},
	{4, 3, 3, 1, 0, 0, 0, 0, 0},
	{4, 3, 3, 1, 0, 0, 0, 0, 0},
	{4, 3, 3, 2, 0, 0, 0, 0, 0},
	{4, 3, 3, 2, 0, 0, 0, 0, 0},
	{4, 3, 3, 3, 1, 0, 0, 0, 0},
	{4, 3, 3, 3, 1, 0, 0, 0, 0},
	{4, 3, 3, 3, 2, 0, 0, 0, 0},
	{4, 3, 3, 3, 2, 0, 0, 0, 0},
}

// pactSlots: Warlock — N slots, all at a single pact level.
var pactCount = [20]int{1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4}
var pactLevel = [20]int{1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5}

// SlotTable returns max slots per spell level (index 0 = level 1) for a
// caster kind at a character level. Unknown kinds get no slots.
func SlotTable(kind string, level int) [9]int {
	if level < 1 {
		level = 1
	}
	if level > 20 {
		level = 20
	}
	switch kind {
	case "full":
		return fullSlots[level-1]
	case "half":
		return halfSlots[level-1]
	case "pact":
		var out [9]int
		out[pactLevel[level-1]-1] = pactCount[level-1]
		return out
	}
	return [9]int{}
}

/*
Multiclass casting (PHB 2024, p.44), which is two separate questions.

	"You determine your available spell slots by adding together the following:
	 • All your levels in the Bard, Cleric, Druid, Sorcerer, and Wizard classes
	 • Half your levels (round up) in the Paladin and Ranger classes
	 • One third of your Fighter or Rogue levels (round down) if you have the
	   Eldritch Knight or Arcane Trickster subclass."

Two things about that are easy to get wrong from memory. Half-casters round
**up** in 2024 — it was down in 2014, so a Paladin 1 already counts as caster
level 1. And Warlocks are absent from the list entirely: Pact Magic is its own
pool, and the two can cast each other's prepared spells but never merge.

The table the total is looked up in is the full-caster table, which is why
this returns the same rows SlotTable("full", …) does rather than a second copy
that could drift from it.
*/

// CasterClass is one class's contribution to the combined caster level: the
// kind of caster it is ("full" | "half" | "third" | "pact" | ""), and how many
// levels the hero holds in it.
type CasterClass struct {
	Kind   string
	Levels int
}

// CasterLevel is the level the Multiclass Spellcaster table is read at. Pact
// and non-casting levels contribute nothing.
func CasterLevel(classes []CasterClass) int {
	total := 0
	for _, c := range classes {
		if c.Levels < 1 {
			continue
		}
		switch c.Kind {
		case "full":
			total += c.Levels
		case "half":
			// Round UP — the 2024 change. Paladin 1 is caster level 1.
			total += (c.Levels + 1) / 2
		case "third":
			total += c.Levels / 3
		}
	}
	return total
}

// PactLevels totals a hero's levels in pact-magic classes, which drive their
// own separate pool.
func PactLevels(classes []CasterClass) int {
	total := 0
	for _, c := range classes {
		if c.Kind == "pact" && c.Levels > 0 {
			total += c.Levels
		}
	}
	return total
}

/*
MulticlassSlots is the shared pool: the Multiclass Spellcaster table at the
combined caster level.

A hero with levels in exactly one casting class is deliberately NOT special-
cased. "If you multiclass but have the Spellcasting feature from only one
class, follow the rules for that class" — and for a full caster the two agree
exactly, while a lone half-caster's own table is the one thing that differs.
So a single casting class uses its own table and anything more uses this one.
*/
func MulticlassSlots(classes []CasterClass) [9]int {
	casting := make([]CasterClass, 0, len(classes))
	for _, c := range classes {
		if c.Levels > 0 && (c.Kind == "full" || c.Kind == "half" || c.Kind == "third") {
			casting = append(casting, c)
		}
	}
	switch len(casting) {
	case 0:
		return [9]int{}
	case 1:
		// Their own class's table, which for a half-caster is not the shared one.
		return SlotTable(casting[0].Kind, casting[0].Levels)
	default:
		return SlotTable("full", CasterLevel(casting))
	}
}

// PactSlotsFor returns how many pact slots a hero has and what level they are.
// Zero count when they have no pact levels.
func PactSlotsFor(pactLevels int) (count, level int) {
	if pactLevels < 1 {
		return 0, 0
	}
	if pactLevels > 20 {
		pactLevels = 20
	}
	return pactCount[pactLevels-1], pactLevel[pactLevels-1]
}

// MaxSpellLevel is the highest spell level with at least one slot.
func MaxSpellLevel(kind string, level int) int {
	table := SlotTable(kind, level)
	max := 0
	for i, n := range table {
		if n > 0 {
			max = i + 1
		}
	}
	return max
}

// Fallback casting tables for homebrew classes that set only data.spellcaster.
var wizardCasting = Casting{
	Ability:  "INT",
	Cantrips: [20]int{3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5},
	Prepared: [20]int{4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 18, 19, 20, 21, 21, 22},
}
var paladinCasting = Casting{
	Ability:  "CHA",
	Cantrips: [20]int{},
	Prepared: [20]int{2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15},
}
var warlockCasting = Casting{
	Ability:  "CHA",
	Cantrips: [20]int{2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4},
	Prepared: [20]int{2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15},
}

// FallbackCasting maps a caster kind to a reasonable default pick table.
func FallbackCasting(kind string) Casting {
	switch kind {
	case "half":
		return paladinCasting
	case "pact":
		return warlockCasting
	default:
		return wizardCasting
	}
}
