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
