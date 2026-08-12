package http

import "testing"

/*
Armor Class when a hero has more than one way to work it out (#190).

	"If you have multiple ways to calculate your Armor Class, you can benefit
	from only one at a time. For example, a Monk/Sorcerer with a Monk's
	Unarmored Defense feature and a Sorcerer's Draconic Resilience feature
	must choose only one of those features as a way to calculate Armor Class."
	(PHB 2024, p.44)

The engine already picks the best rather than summing, which is the choice a
player would make. These pin it: adding a second formula must never be worth
more than having the better of the two, because the day that changes is the
day a Monk/Sorcerer quietly walks around with an AC nobody can explain.
*/

func mods(str, dex, con, intel, wis, cha int) map[string]int {
	return map[string]int{"str": str, "dex": dex, "con": con, "int": intel, "wis": wis, "cha": cha}
}

func unarmored(base int, abilities ...string) heroFeature {
	b := base
	return heroFeature{UnarmoredDefense: &unarmoredDefense{Base: &b, Abilities: abilities}}
}

func TestTwoUnarmoredFormulasDoNotStack(t *testing.T) {
	// DEX +3, WIS +2, CON +1. Monk reads 10+3+2 = 15; a draconic 13+DEX reads
	// 16. Summing them would be 21 and change, which is the bug.
	abilities := mods(10, 16, 12, 10, 14, 10)
	monk := unarmored(10, "dex", "wis")
	draconic := unarmored(13, "dex")

	both := armorClass(nil, abilities, []heroFeature{monk, draconic})
	if both != 16 {
		t.Errorf("AC with both formulas = %d; want 16, the better of the two", both)
	}

	alone := armorClass(nil, abilities, []heroFeature{draconic})
	if both != alone {
		t.Errorf("a second formula changed the answer: %d with, %d without", both, alone)
	}
}

// Order must not decide it either — the better one wins whichever is read first.
func TestTheBetterFormulaWinsWhicheverComesFirst(t *testing.T) {
	abilities := mods(10, 16, 12, 10, 14, 10)
	monk := unarmored(10, "dex", "wis")
	draconic := unarmored(13, "dex")

	a := armorClass(nil, abilities, []heroFeature{monk, draconic})
	b := armorClass(nil, abilities, []heroFeature{draconic, monk})
	if a != b {
		t.Errorf("order changed the AC: %d then %d", a, b)
	}
}

// And a formula never makes a hero worse off than the plain 10 + DEX.
func TestAWeakFormulaIsIgnoredRatherThanImposed(t *testing.T) {
	abilities := mods(10, 18, 8, 10, 8, 10) // DEX +4 → 14 unarmoured
	feeble := unarmored(10, "con")          // 10 + (-1) = 9

	if got := armorClass(nil, abilities, []heroFeature{feeble}); got != 14 {
		t.Errorf("AC = %d; want 14 — a feature is a benefit, not a cap", got)
	}
}
