package http

import (
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

/*
The two rests (#118), away from the database and away from the dice.

The short rest heals a random amount, which is exactly the kind of thing that
gets tested by running it once and declaring it fine. The roll is injected, so
these say what a rest is worth rather than what one run of it happened to give.
*/

func hero(level, hp, hpMax int) db.Character {
	return db.Character{
		Level:          int32(level),
		HpCurrent:      int32(hp),
		HpMax:          int32(hpMax),
		SpellSlotsUsed: []int16{2, 1, 0, 0, 0, 0, 0, 0, 0},
	}
}

// pool is one die type the hero holds — since #190 the dice are pooled per
// size and passed in rather than derived from level and a single die.
func pool(die, max, used int) rules.HitDicePool {
	return rules.HitDicePool{Die: die, Max: max, Used: used}
}

// always returns the same face every time, so the arithmetic is the only
// variable left.
func always(n int) func(int) int { return func(int) int { return n } }

func TestLongRestMakesAHeroWhole(t *testing.T) {
	out := longRest(hero(8, 14, 52), nil, []rules.HitDicePool{pool(10, 8, 5)})

	if out.HP != 52 {
		t.Errorf("HP = %d; want the hero's full %d", out.HP, 52)
	}
	if out.HPRestored != 38 {
		t.Errorf("HPRestored = %d; want 38", out.HPRestored)
	}
	for i, u := range out.SlotsUsed {
		if u != 0 {
			t.Errorf("slot level %d still shows %d spent after a long rest", i+1, u)
		}
	}
	if !out.SlotsRestored {
		t.Error("a long rest returns every slot")
	}
	// PHB 2024: every spent die returns — all five (#244; 2014 said half).
	if out.HitDiceRegained != 5 || out.HitDiceSpentMap[10] != 0 {
		t.Errorf("regained %d leaving %d spent; want 5 and 0", out.HitDiceRegained, out.HitDiceSpentMap[10])
	}
}

// The smallest case of the same 2024 rule — one spent die, one die back.
func TestALevelOneHeroGetsTheirOnlyHitDieBack(t *testing.T) {
	out := longRest(hero(1, 3, 9), nil, []rules.HitDicePool{pool(8, 1, 1)})
	if out.HitDiceRegained != 1 || out.HitDiceSpentMap[8] != 0 {
		t.Errorf("regained %d leaving %d spent; want 1 and 0", out.HitDiceRegained, out.HitDiceSpentMap[8])
	}
}

func TestALongRestCannotBankDiceThatWereNeverSpent(t *testing.T) {
	out := longRest(hero(10, 40, 40), nil, []rules.HitDicePool{pool(8, 10, 1)})
	if out.HitDiceRegained != 1 || out.HitDiceSpentMap[8] != 0 {
		t.Errorf("regained %d leaving %d spent; want 1 and 0 — only one was spent",
			out.HitDiceRegained, out.HitDiceSpentMap[8])
	}
	if out.HPRestored != 0 {
		t.Errorf("HPRestored = %d; a whole hero regains nothing", out.HPRestored)
	}
}

func TestShortRestSpendsDiceToHeal(t *testing.T) {
	// d10 hero, CON +2, three dice spent, each rolling 6 → 3 × 8 = 24.
	out := shortRest(hero(5, 10, 44), nil, []rules.HitDicePool{pool(10, 5, 0)},
		map[int]int{10: 3}, 2, false, always(6))

	if out.HitDiceSpent != 3 || out.HitDiceSpentMap[10] != 3 {
		t.Errorf("spent %d leaving %d used; want 3 and 3", out.HitDiceSpent, out.HitDiceSpentMap[10])
	}
	if out.HP != 34 || out.HPRestored != 24 {
		t.Errorf("HP %d (+%d); want 34 (+24)", out.HP, out.HPRestored)
	}
	if len(out.Rolls) != 3 {
		t.Errorf("reported %d rolls; want one per die spent", len(out.Rolls))
	}
}

func TestShortRestCannotHealPastFull(t *testing.T) {
	out := shortRest(hero(5, 40, 44), nil, []rules.HitDicePool{pool(10, 5, 0)},
		map[int]int{10: 3}, 2, false, always(10))
	if out.HP != 44 || out.HPRestored != 4 {
		t.Errorf("HP %d (+%d); want 44 (+4) — the rest stops at whole", out.HP, out.HPRestored)
	}
	// The dice are still spent. Overhealing wastes them, as it does at a table.
	if out.HitDiceSpent != 3 {
		t.Errorf("spent %d; want 3 — a die spent on an overheal is still spent", out.HitDiceSpent)
	}
}

func TestShortRestCannotSpendDiceTheHeroDoesNotHave(t *testing.T) {
	// Level 3, two already spent: one left however many are asked for.
	out := shortRest(hero(3, 5, 24), nil, []rules.HitDicePool{pool(8, 3, 2)},
		map[int]int{8: 9}, 0, false, always(4))
	if out.HitDiceSpent != 1 || out.HitDiceSpentMap[8] != 3 {
		t.Errorf("spent %d leaving %d used; want 1 and 3", out.HitDiceSpent, out.HitDiceSpentMap[8])
	}

	none := shortRest(hero(3, 5, 24), nil, []rules.HitDicePool{pool(8, 3, 3)},
		map[int]int{8: 2}, 0, false, always(4))
	if none.HitDiceSpent != 0 || none.HPRestored != 0 {
		t.Errorf("a hero with no dice left healed %d from %d dice", none.HPRestored, none.HitDiceSpent)
	}
}

/*
A multiclassed hero spends the die they chose, and only that one (#190).

The single-count column this replaced could not tell a d8 from a d10, so a
Cleric 5 / Paladin 5 spending a Paladin die used up a Cleric one.
*/
func TestShortRestSpendsOnlyTheDieTypeAskedFor(t *testing.T) {
	dice := []rules.HitDicePool{pool(10, 5, 0), pool(8, 5, 0)}
	// Two d10 at 6 each, CON +1 → 14.
	out := shortRest(hero(10, 20, 60), nil, dice, map[int]int{10: 2}, 1, false, always(6))

	if out.HitDiceSpentMap[10] != 2 {
		t.Errorf("d10 spent = %d; want 2", out.HitDiceSpentMap[10])
	}
	if out.HitDiceSpentMap[8] != 0 {
		t.Errorf("d8 spent = %d; the Cleric's dice were not offered", out.HitDiceSpentMap[8])
	}
	if out.HPRestored != 14 {
		t.Errorf("healed %d; want 14", out.HPRestored)
	}
}

// And a mix in one rest, because a short rest also hands back pools and pact
// slots — taking two rests to spend two die types would refill those twice.
func TestShortRestSpendsAMixOfDiceInOneGo(t *testing.T) {
	dice := []rules.HitDicePool{pool(12, 2, 0), pool(6, 2, 0)}
	out := shortRest(hero(4, 10, 60), nil, dice, map[int]int{12: 1, 6: 2}, 0, false, always(3))

	if out.HitDiceSpent != 3 {
		t.Errorf("spent %d dice; want 3 across both types", out.HitDiceSpent)
	}
	if out.HitDiceSpentMap[12] != 1 || out.HitDiceSpentMap[6] != 2 {
		t.Errorf("spent d12 %d and d6 %d; want 1 and 2",
			out.HitDiceSpentMap[12], out.HitDiceSpentMap[6])
	}
	if len(out.Rolls) != 3 {
		t.Errorf("reported %d rolls; want one per die", len(out.Rolls))
	}
}

// A frail hero rolling badly loses the die and heals nothing — the rest must
// not take hit points off them for trying.
func TestABadRollNeverCostsHitPoints(t *testing.T) {
	out := shortRest(hero(4, 12, 30), nil, []rules.HitDicePool{pool(6, 4, 0)},
		map[int]int{6: 2}, -3, false, always(1))
	if out.HP != 12 || out.HPRestored != 0 {
		t.Errorf("HP %d (+%d); want 12 (+0) — a die can heal nothing, never less", out.HP, out.HPRestored)
	}
	if out.HitDiceSpent != 2 {
		t.Errorf("spent %d; want 2 — the dice were still burned", out.HitDiceSpent)
	}
}

/*
The one rule that makes a Warlock a Warlock at the table: their slots come back
over an hour, and everyone else's wait for the night.
*/
func TestOnlyAPactCasterGetsSlotsBackOnAShortRest(t *testing.T) {
	spent := hero(5, 30, 30)
	none := map[int]int{}

	wizard := shortRest(spent, nil, []rules.HitDicePool{pool(6, 5, 0)}, none, 1, false, always(3))
	if wizard.SlotsRestored {
		t.Error("a prepared caster's slots do not return on a short rest")
	}
	if len(wizard.SlotsUsed) == 0 || wizard.SlotsUsed[0] != 2 {
		t.Errorf("slots = %v; want them left exactly as they were", wizard.SlotsUsed)
	}

	// Since #190 pact slots have their own counter, so what comes back over an
	// hour is that — and only that. A Warlock 3 / Wizard 3 keeps their Wizard
	// slots spent, which sharing one array could not express.
	pactSpent := hero(5, 30, 30)
	pactSpent.PactSlotsUsed = 2
	warlock := shortRest(pactSpent, nil, []rules.HitDicePool{pool(8, 5, 0)}, none, 1, true, always(3))
	if !warlock.SlotsRestored {
		t.Error("a pact caster's slots come back on a short rest")
	}
	if warlock.PactUsed != 0 {
		t.Errorf("pact slots still show %d spent after an hour", warlock.PactUsed)
	}
	if len(warlock.SlotsUsed) == 0 || warlock.SlotsUsed[0] != 2 {
		t.Errorf("the shared pool = %v; a short rest must leave it alone", warlock.SlotsUsed)
	}
}

// And the night returns both.
func TestALongRestReturnsThePactPoolToo(t *testing.T) {
	ch := hero(5, 10, 30)
	ch.PactSlotsUsed = 2
	out := longRest(ch, nil, []rules.HitDicePool{pool(8, 5, 0)})

	if out.PactUsed != 0 {
		t.Errorf("pact slots still show %d spent after a long rest", out.PactUsed)
	}
	for i, u := range out.SlotsUsed {
		if u != 0 {
			t.Errorf("shared slot level %d still shows %d spent", i+1, u)
		}
	}
}

// A short rest with nothing spent is a legal thing to take — a Warlock catching
// their breath wants the slots, not the dice.
func TestAShortRestSpendingNothingStillRests(t *testing.T) {
	out := shortRest(hero(5, 20, 44), nil, []rules.HitDicePool{pool(10, 5, 1)},
		map[int]int{}, 3, false, always(9))
	if out.HitDiceSpent != 0 || out.HPRestored != 0 || out.HitDiceSpentMap[10] != 1 {
		t.Errorf("spent %d, healed %d, used now %d; want 0, 0, 1",
			out.HitDiceSpent, out.HPRestored, out.HitDiceSpentMap[10])
	}
	if len(out.Rolls) != 0 {
		t.Errorf("rolled %v; want nothing rolled", out.Rolls)
	}
}

/*
Resource pools at rest (#175). A long rest refills every pool; a short rest
gives each pool what its declaration says — nothing, one use, or all of them.
The 2024 books lean hard on "one": Rage, Channel Divinity, Second Wind and
Wild Shape all hand a single use back over an hour.
*/

func spentPools() []resolvedPool {
	return []resolvedPool{
		{Name: "Rages", Max: 3, Used: 3, ShortRest: "one"},
		{Name: "Focus Points", Max: 5, Used: 4, ShortRest: "all"},
		{Name: "Lay On Hands", Max: 15, Used: 10, ShortRest: "none"},
	}
}

func TestALongRestRefillsEveryPool(t *testing.T) {
	used, restored := restPools(spentPools(), "long")
	if len(used) != 0 {
		t.Errorf("pools still spent after a long rest: %v", used)
	}
	if len(restored) != 3 {
		t.Errorf("restored %v; want all three named", restored)
	}
}

func TestAShortRestGivesEachPoolWhatItsRuleSays(t *testing.T) {
	used, restored := restPools(spentPools(), "short")
	if used["Rages"] != 2 {
		t.Errorf("Rages spent = %d; want 2 — one use back, not all", used["Rages"])
	}
	if _, still := used["Focus Points"]; still {
		t.Error("Focus Points should refill entirely on a short rest")
	}
	if used["Lay On Hands"] != 10 {
		t.Errorf("Lay On Hands spent = %d; want 10 — it waits for the night", used["Lay On Hands"])
	}
	if len(restored) != 2 {
		t.Errorf("restored %v; want Rages and Focus Points only", restored)
	}
}

func TestAFullPoolHasNothingToRestore(t *testing.T) {
	fresh := []resolvedPool{{Name: "Rages", Max: 3, Used: 0, ShortRest: "one"}}
	used, restored := restPools(fresh, "short")
	if len(used) != 0 || len(restored) != 0 {
		t.Errorf("an unspent pool moved: used %v, restored %v", used, restored)
	}
	usedLong, restoredLong := restPools(fresh, "long")
	if len(usedLong) != 0 || len(restoredLong) != 0 {
		t.Errorf("an unspent pool moved on a long rest: used %v, restored %v", usedLong, restoredLong)
	}
}

func TestRestingWithNoPoolsIsQuiet(t *testing.T) {
	used, restored := restPools(nil, "long")
	if len(used) != 0 || len(restored) != 0 {
		t.Errorf("no pools should mean nothing written and nothing reported, got %v / %v", used, restored)
	}
}
