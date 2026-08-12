package rules

import "testing"

func poolMap(pools []HitDicePool) map[int]HitDicePool {
	out := map[int]HitDicePool{}
	for _, p := range pools {
		out[p.Die] = p
	}
	return out
}

func TestSameDieTypesPoolTogether(t *testing.T) {
	// The book's own example: a level 5 Fighter / level 5 Paladin, both d10,
	// has ten d10 rather than two piles of five.
	pools := HitDicePools([]ClassDie{{Die: 10, Levels: 5}, {Die: 10, Levels: 5}}, 0, nil)

	if len(pools) != 1 {
		t.Fatalf("got %d pools; want one shared d10 pool", len(pools))
	}
	if pools[0].Die != 10 || pools[0].Max != 10 {
		t.Errorf("got d%d x%d; want d10 x10", pools[0].Die, pools[0].Max)
	}
}

func TestDifferentDieTypesAreTrackedApart(t *testing.T) {
	// The book's other example: level 5 Cleric (d8) / level 5 Paladin (d10).
	pools := HitDicePools([]ClassDie{{Die: 8, Levels: 5}, {Die: 10, Levels: 5}}, 0, map[int]int{10: 2})
	by := poolMap(pools)

	if by[8].Max != 5 || by[8].Used != 0 {
		t.Errorf("d8 reads %d/%d; want 0 used of 5", by[8].Used, by[8].Max)
	}
	if by[10].Max != 5 || by[10].Used != 2 {
		t.Errorf("d10 reads %d/%d; want 2 used of 5", by[10].Used, by[10].Max)
	}
	// Spending a d10 must not have eaten a d8 — the bug the old single count had.
	if TotalHitDiceLeft(pools) != 8 {
		t.Errorf("eight dice should remain; got %d", TotalHitDiceLeft(pools))
	}
}

func TestLargestDieFirst(t *testing.T) {
	pools := HitDicePools([]ClassDie{{Die: 6, Levels: 1}, {Die: 12, Levels: 1}, {Die: 8, Levels: 1}}, 0, nil)

	if pools[0].Die != 12 || pools[2].Die != 6 {
		t.Errorf("want d12 first and d6 last; got %d then %d", pools[0].Die, pools[2].Die)
	}
}

func TestQuickAddHeroGetsD8ByLevel(t *testing.T) {
	pools := HitDicePools(nil, 4, nil)

	if len(pools) != 1 || pools[0].Die != DefaultHitDie || pools[0].Max != 4 {
		t.Errorf("a hero with no classes should have 4d8; got %+v", pools)
	}
}

func TestSpendingIsClampedToWhatIsLeft(t *testing.T) {
	pools := HitDicePools([]ClassDie{{Die: 10, Levels: 3}}, 0, map[int]int{10: 1})

	spent, taken := SpendHitDice(pools, map[int]int{10: 99})
	if taken[10] != 2 {
		t.Errorf("only two d10 remained; took %d", taken[10])
	}
	if spent[10] != 3 {
		t.Errorf("all three should now be spent; got %d", spent[10])
	}
}

func TestSpendingOneDieLeavesTheOtherAlone(t *testing.T) {
	pools := HitDicePools([]ClassDie{{Die: 8, Levels: 5}, {Die: 10, Levels: 5}}, 0, nil)

	spent, taken := SpendHitDice(pools, map[int]int{10: 2})
	if taken[8] != 0 {
		t.Errorf("no d8 was asked for; took %d", taken[8])
	}
	if spent[8] != 0 {
		t.Errorf("the d8 pool should be untouched; got %d spent", spent[8])
	}
	if spent[10] != 2 {
		t.Errorf("two d10 spent; got %d", spent[10])
	}
}

func TestLongRestGivesBackHalfTheDiceLargestFirst(t *testing.T) {
	// Level 10 hero, everything spent: half of ten is five back, and a player
	// choosing would take the d10s.
	pools := HitDicePools(
		[]ClassDie{{Die: 8, Levels: 5}, {Die: 10, Levels: 5}}, 0,
		map[int]int{8: 5, 10: 5},
	)

	spent, regained := RegainHitDice(pools, 10)
	if regained != 5 {
		t.Errorf("regained %d; want 5", regained)
	}
	if spent[10] != 0 {
		t.Errorf("the five d10 should all be back; %d still spent", spent[10])
	}
	if spent[8] != 5 {
		t.Errorf("the d8 pool was not reached; want 5 still spent, got %d", spent[8])
	}
}

func TestLongRestNeverGivesBackMoreThanWasSpent(t *testing.T) {
	pools := HitDicePools([]ClassDie{{Die: 10, Levels: 10}}, 0, map[int]int{10: 2})

	spent, regained := RegainHitDice(pools, 10)
	if regained != 2 {
		t.Errorf("only two were spent; regained %d", regained)
	}
	if len(spent) != 0 {
		t.Errorf("nothing should remain spent; got %+v", spent)
	}
}

// "half your total, minimum one" — a level 1 hero gets their single die back.
func TestLevelOneHeroGetsTheirOneDieBack(t *testing.T) {
	pools := HitDicePools([]ClassDie{{Die: 12, Levels: 1}}, 0, map[int]int{12: 1})

	_, regained := RegainHitDice(pools, 1)
	if regained != 1 {
		t.Errorf("regained %d; want 1", regained)
	}
}

// A die that is spent but no longer granted must not disappear silently.
func TestDiceSpentOnALostClassStillShow(t *testing.T) {
	pools := HitDicePools([]ClassDie{{Die: 10, Levels: 3}}, 0, map[int]int{6: 2})
	by := poolMap(pools)

	if _, ok := by[6]; !ok {
		t.Fatal("the orphaned d6 should still be listed")
	}
	if by[6].Max != 0 || by[6].Used != 0 {
		// Used is clamped to Max, so it reads 0/0 — visible, and plainly odd.
		t.Errorf("orphaned pool reads %d/%d; want 0/0", by[6].Used, by[6].Max)
	}
}
