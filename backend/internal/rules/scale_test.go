package rules

import "testing"

// A level-5 Artificer with Intelligence 18 — the hero every Steel Defender
// example in this file is attached to.
func artificer() Scope {
	return ScopeFor(5, map[string]int{"str": 14, "dex": 12, "con": 14, "int": 18, "wis": 10, "cha": 8})
}

func TestEvalReadsTheHeroBehindTheFormula(t *testing.T) {
	cases := []struct {
		expr string
		want int
	}{
		// A Steel Defender's hit points: 2 + Int modifier + five per level.
		{"2 + int + 5 * level", 31},
		{"level", 5},
		{"prof", 3},
		{"int", 4},
		{"intScore", 18},
		{"cha", -1},
		{"10 + dex", 11},
		// Precedence and parentheses.
		{"2 + 3 * 4", 14},
		{"(2 + 3) * 4", 20},
		{"-3 + 10", 7},
		// Rounding is down, everywhere, as the 2024 rules round.
		{"level / 2", 2},
		{"floor(level / 2) * 3", 6},
		{"ceil(level / 2)", 3},
		{"max(1, cha)", 1},
		{"min(prof, level)", 3},
	}
	for _, tc := range cases {
		got, err := Eval(tc.expr, artificer())
		if err != nil {
			t.Errorf("Eval(%q) errored: %v", tc.expr, err)
			continue
		}
		if got != tc.want {
			t.Errorf("Eval(%q) = %d, want %d", tc.expr, got, tc.want)
		}
	}
}

func TestEvalRefusesWhatItCannotName(t *testing.T) {
	for _, expr := range []string{
		"",
		"5 +",
		"(1 + 2",
		"wisdom",            // the modifiers are three letters
		"level * ",          // an operator with nothing after it
		"1 / 0",             // division by zero
		"sqrt(4)",           // not in the function list
		"level; DROP TABLE", // nothing here is an escape hatch
	} {
		if _, err := Eval(expr, artificer()); err == nil {
			t.Errorf("Eval(%q) should have failed", expr)
		}
	}
}

func TestScopeTreatsMissingScoresAsTen(t *testing.T) {
	scope := ScopeFor(3, nil)
	for _, ab := range []string{"str", "dex", "con", "int", "wis", "cha"} {
		if got := scope.Mods[ab]; got != 0 {
			t.Errorf("missing %s should read as a +0 modifier, got %+d", ab, got)
		}
	}
}

func TestProfBonusFollowsTheTable(t *testing.T) {
	cases := map[int]int{1: 2, 4: 2, 5: 3, 8: 3, 9: 4, 13: 5, 17: 6, 20: 6, 25: 6, 0: 2}
	for level, want := range cases {
		if got := ProfBonus(level); got != want {
			t.Errorf("ProfBonus(%d) = %d, want %d", level, got, want)
		}
	}
}
