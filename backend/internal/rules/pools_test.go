package rules

import "testing"

func TestPoolsInReadsBothShapes(t *testing.T) {
	data := []byte(`{
		"pools": [
			{"name": "Rages", "uses": [2,2,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6,6,6], "shortRest": "one"},
			{"name": "Focus Points", "level": 2, "uses": "level", "shortRest": "all"}
		]
	}`)
	pools := PoolsIn(data)
	if len(pools) != 2 {
		t.Fatalf("expected 2 pools, got %d", len(pools))
	}
	if pools[0].Uses.Table == nil || pools[0].Uses.Table[0] != 2 {
		t.Errorf("Rages should read as a table starting at 2, got %+v", pools[0].Uses)
	}
	if pools[1].Uses.Expr != "level" {
		t.Errorf("Focus Points should read as the expression %q, got %+v", "level", pools[1].Uses)
	}
}

func TestPoolsInToleratesAbsenceAndRot(t *testing.T) {
	if got := PoolsIn(nil); got != nil {
		t.Errorf("no data should mean no pools, got %+v", got)
	}
	if got := PoolsIn([]byte(`{"hitDie": 12}`)); got != nil {
		t.Errorf("data without pools should mean no pools, got %+v", got)
	}
	if got := PoolsIn([]byte(`{"pools": [{"name": "Rages", "uses": {"bad": true}}]}`)); got != nil {
		t.Errorf("a malformed declaration should read as no pools, got %+v", got)
	}
}

func TestPoolMaxFromTable(t *testing.T) {
	rages := PoolGrant{Name: "Rages", Uses: PoolUses{
		Table: []int{2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6},
	}}
	cases := []struct{ level, want int }{
		{1, 2}, {3, 3}, {5, 3}, {6, 4}, {12, 5}, {17, 6}, {20, 6},
		// Out-of-range levels clamp to the table's ends rather than crash.
		{0, 2}, {25, 6},
	}
	for _, c := range cases {
		if got := rages.Max(ScopeFor(c.level, nil)); got != c.want {
			t.Errorf("Rages at level %d: expected %d, got %d", c.level, c.want, got)
		}
	}
}

func TestPoolMaxFromExpression(t *testing.T) {
	focus := PoolGrant{Name: "Focus Points", Level: 2, Uses: PoolUses{Expr: "level"}}
	if got := focus.Max(ScopeFor(1, nil)); got != 0 {
		t.Errorf("a level-gated pool should be absent below its level, got %d", got)
	}
	if got := focus.Max(ScopeFor(5, nil)); got != 5 {
		t.Errorf("Focus Points at level 5: expected 5, got %d", got)
	}

	inspiration := PoolGrant{Name: "Bardic Inspiration", Uses: PoolUses{Expr: "max(1, cha)"}}
	scores := map[string]int{"cha": 16}
	if got := inspiration.Max(ScopeFor(3, scores)); got != 3 {
		t.Errorf("Bardic Inspiration with CHA 16: expected 3, got %d", got)
	}
	if got := inspiration.Max(ScopeFor(3, map[string]int{"cha": 8})); got != 1 {
		t.Errorf("Bardic Inspiration never drops below 1, got %d", got)
	}

	broken := PoolGrant{Name: "Broken", Uses: PoolUses{Expr: "level +"}}
	if got := broken.Max(ScopeFor(5, nil)); got != 0 {
		t.Errorf("an unevaluable pool should read as absent, got %d", got)
	}
}

func TestShortRestKindDefaultsToNone(t *testing.T) {
	cases := map[string]string{"": ShortRestNone, "none": ShortRestNone,
		"one": ShortRestOne, "all": ShortRestAll, "sometimes": ShortRestNone}
	for declared, want := range cases {
		g := PoolGrant{ShortRest: declared}
		if got := g.ShortRestKindAt(1); got != want {
			t.Errorf("shortRest %q: expected %q, got %q", declared, want, got)
		}
	}
}

// Font of Inspiration: the refill rule itself can wait for a level. Below it
// the pool exists but only the night refills it.
func TestShortRestRuleCanWaitForALevel(t *testing.T) {
	inspiration := PoolGrant{Name: "Bardic Inspiration", ShortRest: ShortRestAll, ShortRestLevel: 5}
	if got := inspiration.ShortRestKindAt(4); got != ShortRestNone {
		t.Errorf("at level 4 the rule has not arrived; expected none, got %q", got)
	}
	if got := inspiration.ShortRestKindAt(5); got != ShortRestAll {
		t.Errorf("at level 5 Font of Inspiration applies; expected all, got %q", got)
	}
}
