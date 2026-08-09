package http

import (
	"strings"
	"testing"
)

/*
The Go half of the dice pool's contract (#176). Its TypeScript twin is
frontend/src/lib/dice.test.ts, reading the same fixture.

The agreement matters more here than in most mirrors: the browser composes
the pool and this side rolls it whenever the roll is public, so a drift would
put one expression on the roller's screen and a different one in the log
everybody reads.
*/

type poolFixtureCase struct {
	Name string `json:"name"`
	Pool struct {
		Groups []struct {
			Count int `json:"count"`
			Sides int `json:"sides"`
		} `json:"groups"`
		Modifier int `json:"modifier"`
	} `json:"pool"`
	Expression string `json:"expression"`
	Min        *int   `json:"min"`
	Max        *int   `json:"max"`
}

func poolOf(c poolFixtureCase) dicePool {
	pool := dicePool{Modifier: c.Pool.Modifier}
	for _, g := range c.Pool.Groups {
		pool.Groups = append(pool.Groups, dieGroup{Count: g.Count, Sides: g.Sides})
	}
	return pool
}

func TestDicePoolFixture(t *testing.T) {
	var fixture struct {
		Cases []poolFixtureCase `json:"cases"`
	}
	loadFixture(t, "dice-pool.json", &fixture)
	if len(fixture.Cases) == 0 {
		t.Fatal("the dice fixture is empty")
	}
	refusals := 0
	for _, c := range fixture.Cases {
		pool := poolOf(c)
		if got := diceExpression(pool); got != c.Expression {
			t.Errorf("%s: expression = %q; want %q", c.Name, got, c.Expression)
		}
		min, max, ok := poolRange(pool)
		if c.Min == nil {
			refusals++
			if ok {
				t.Errorf("%s: expected an unrollable pool, got %d..%d", c.Name, min, max)
			}
			if _, rolled := rollPool(pool); rolled {
				t.Errorf("%s: an unrollable pool was rolled anyway", c.Name)
			}
			continue
		}
		if !ok {
			t.Errorf("%s: expected a rollable pool", c.Name)
			continue
		}
		if min != *c.Min || max != *c.Max {
			t.Errorf("%s: range = %d..%d; want %d..%d", c.Name, min, max, *c.Min, *c.Max)
		}
	}
	if refusals < 3 {
		t.Errorf("the fixture should hold refusals too; found %d", refusals)
	}
}

func TestRollPoolStaysInRange(t *testing.T) {
	pool := dicePool{
		Groups:   []dieGroup{{Count: 2, Sides: 6}, {Count: 1, Sides: 8}},
		Modifier: 3,
	}
	min, max, ok := poolRange(pool)
	if !ok {
		t.Fatal("expected a rollable pool")
	}
	for i := 0; i < 500; i++ {
		r, rolled := rollPool(pool)
		if !rolled {
			t.Fatal("expected a roll")
		}
		if r.Total < min || r.Total > max {
			t.Fatalf("total %d outside %d..%d", r.Total, min, max)
		}
		faces := 0
		for _, g := range r.Groups {
			for _, f := range g.Results {
				if f < 1 || f > g.Sides {
					t.Fatalf("d%d rolled %d", g.Sides, f)
				}
				faces++
			}
		}
		if faces != 3 {
			t.Fatalf("rolled %d dice; want 3", faces)
		}
	}
}

// A natural 20 is a d20 test's business — a fistful of d20s is not one, and
// neither is a d20 rolled alongside something else.
func TestCritOnlyOnALoneD20(t *testing.T) {
	for i := 0; i < 200; i++ {
		if r, _ := rollPool(dicePool{Groups: []dieGroup{{Count: 2, Sides: 20}}}); r.Crit || r.Fail {
			t.Fatal("a pair of d20s should never be called")
		}
		if r, _ := rollPool(dicePool{
			Groups: []dieGroup{{Count: 1, Sides: 20}, {Count: 1, Sides: 6}},
		}); r.Crit || r.Fail {
			t.Fatal("a d20 beside another die should never be called")
		}
	}
}

func TestRollLineShowsTheDiceNotJustTheTotal(t *testing.T) {
	r := poolResult{
		Expression: "2d6 + 3",
		Groups:     []rolledGroup{{Sides: 6, Results: []int{5, 2}}},
		Modifier:   3,
		Total:      10,
	}
	line := rollLine("Bramble", "Fireball", r)
	for _, want := range []string{"Bramble rolls", "Fireball", "2d6 + 3", "5, 2", "= 10"} {
		if !strings.Contains(line, want) {
			t.Errorf("roll line %q is missing %q", line, want)
		}
	}
	// The chronicle prints a message verbatim, so markup would reach the feed
	// as literal characters.
	for _, markup := range []string{"**", "_"} {
		if strings.Contains(line, markup) {
			t.Errorf("roll line %q carries markup %q the chronicle will not render", line, markup)
		}
	}

	// A lone die with nothing added is its own total — "1d20: 18 = 18" reads
	// like the log is showing its working for no reason.
	lone := poolResult{
		Expression: "1d20",
		Groups:     []rolledGroup{{Sides: 20, Results: []int{18}}},
		Total:      18,
	}
	if got := rollLine("Bramble", "", lone); got != "Bramble rolls 1d20: 18" {
		t.Errorf("lone die line = %q", got)
	}
	// But a modifier means there is arithmetic worth showing.
	withMod := poolResult{
		Expression: "1d20 + 5",
		Groups:     []rolledGroup{{Sides: 20, Results: []int{18}}},
		Modifier:   5,
		Total:      23,
	}
	if got := rollLine("Bramble", "", withMod); !strings.Contains(got, "= 23") {
		t.Errorf("modified line %q should show the total", got)
	}

	// A negative modifier reads as a subtraction, not "+ -2".
	neg := poolResult{
		Expression: "1d20 − 2",
		Groups:     []rolledGroup{{Sides: 20, Results: []int{9}}},
		Modifier:   -2,
		Total:      7,
	}
	if line := rollLine("Bramble", "", neg); strings.Contains(line, "+ -") {
		t.Errorf("negative modifier read as %q", line)
	}
}
