package http

import (
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
The two rests (#118), away from the database and away from the dice.

The short rest heals a random amount, which is exactly the kind of thing that
gets tested by running it once and declaring it fine. The roll is injected, so
these say what a rest is worth rather than what one run of it happened to give.
*/

func hero(level, hp, hpMax, hitDiceUsed int) db.Character {
	return db.Character{
		Level:          int32(level),
		HpCurrent:      int32(hp),
		HpMax:          int32(hpMax),
		HitDiceUsed:    int16(hitDiceUsed),
		SpellSlotsUsed: []int16{2, 1, 0, 0, 0, 0, 0, 0, 0},
	}
}

// always returns the same face every time, so the arithmetic is the only
// variable left.
func always(n int) func(int) int { return func(int) int { return n } }

func TestLongRestMakesAHeroWhole(t *testing.T) {
	out := longRest(hero(8, 14, 52, 5), nil)

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
	// Half of eight is four, of the five that were spent.
	if out.HitDiceRegained != 4 || out.HitDiceUsed != 1 {
		t.Errorf("regained %d leaving %d spent; want 4 and 1", out.HitDiceRegained, out.HitDiceUsed)
	}
}

// "Half your total, minimum one" — the minimum is the whole of the rule at low
// levels, where half of one is none and a level 1 hero would never get their
// single die back.
func TestALevelOneHeroGetsTheirOnlyHitDieBack(t *testing.T) {
	out := longRest(hero(1, 3, 9, 1), nil)
	if out.HitDiceRegained != 1 || out.HitDiceUsed != 0 {
		t.Errorf("regained %d leaving %d spent; want 1 and 0", out.HitDiceRegained, out.HitDiceUsed)
	}
}

func TestALongRestCannotBankDiceThatWereNeverSpent(t *testing.T) {
	out := longRest(hero(10, 40, 40, 1), nil)
	if out.HitDiceRegained != 1 || out.HitDiceUsed != 0 {
		t.Errorf("regained %d leaving %d spent; want 1 and 0 — only one was spent",
			out.HitDiceRegained, out.HitDiceUsed)
	}
	if out.HPRestored != 0 {
		t.Errorf("HPRestored = %d; a whole hero regains nothing", out.HPRestored)
	}
}

func TestShortRestSpendsDiceToHeal(t *testing.T) {
	// d10 hero, CON +2, three dice spent, each rolling 6 → 3 × 8 = 24.
	out := shortRest(hero(5, 10, 44, 0), nil, 3, 10, 2, false, always(6))

	if out.HitDiceSpent != 3 || out.HitDiceUsed != 3 {
		t.Errorf("spent %d leaving %d used; want 3 and 3", out.HitDiceSpent, out.HitDiceUsed)
	}
	if out.HP != 34 || out.HPRestored != 24 {
		t.Errorf("HP %d (+%d); want 34 (+24)", out.HP, out.HPRestored)
	}
	if len(out.Rolls) != 3 {
		t.Errorf("reported %d rolls; want one per die spent", len(out.Rolls))
	}
}

func TestShortRestCannotHealPastFull(t *testing.T) {
	out := shortRest(hero(5, 40, 44, 0), nil, 3, 10, 2, false, always(10))
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
	out := shortRest(hero(3, 5, 24, 2), nil, 9, 8, 0, false, always(4))
	if out.HitDiceSpent != 1 || out.HitDiceUsed != 3 {
		t.Errorf("spent %d leaving %d used; want 1 and 3", out.HitDiceSpent, out.HitDiceUsed)
	}

	none := shortRest(hero(3, 5, 24, 3), nil, 2, 8, 0, false, always(4))
	if none.HitDiceSpent != 0 || none.HPRestored != 0 {
		t.Errorf("a hero with no dice left healed %d from %d dice", none.HPRestored, none.HitDiceSpent)
	}
}

// A frail hero rolling badly loses the die and heals nothing — the rest must
// not take hit points off them for trying.
func TestABadRollNeverCostsHitPoints(t *testing.T) {
	out := shortRest(hero(4, 12, 30, 0), nil, 2, 6, -3, false, always(1))
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
	spent := hero(5, 30, 30, 0)

	wizard := shortRest(spent, nil, 0, 6, 1, false, always(3))
	if wizard.SlotsRestored {
		t.Error("a prepared caster's slots do not return on a short rest")
	}
	if len(wizard.SlotsUsed) == 0 || wizard.SlotsUsed[0] != 2 {
		t.Errorf("slots = %v; want them left exactly as they were", wizard.SlotsUsed)
	}

	warlock := shortRest(spent, nil, 0, 8, 1, true, always(3))
	if !warlock.SlotsRestored {
		t.Error("a pact caster's slots come back on a short rest")
	}
	for i, u := range warlock.SlotsUsed {
		if u != 0 {
			t.Errorf("pact slot level %d still shows %d spent", i+1, u)
		}
	}
}

// A short rest with nothing spent is a legal thing to take — a Warlock catching
// their breath wants the slots, not the dice.
func TestAShortRestSpendingNothingStillRests(t *testing.T) {
	out := shortRest(hero(5, 20, 44, 1), nil, 0, 10, 3, false, always(9))
	if out.HitDiceSpent != 0 || out.HPRestored != 0 || out.HitDiceUsed != 1 {
		t.Errorf("spent %d, healed %d, used now %d; want 0, 0, 1",
			out.HitDiceSpent, out.HPRestored, out.HitDiceUsed)
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
