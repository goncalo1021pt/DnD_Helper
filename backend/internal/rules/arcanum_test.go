package rules

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestArcanumOpensOneSpellLevelAtATime(t *testing.T) {
	g := ArcanumIn([]byte(`{"arcanum":[{"level":11,"spellLevel":6},{"level":13,"spellLevel":7},{"level":15,"spellLevel":8},{"level":17,"spellLevel":9}]}`))
	if got := ArcanumOpen(g, 10); len(got) != 0 {
		t.Fatalf("nothing opens before 11, got %v", got)
	}
	if got, want := ArcanumOpen(g, 14), map[int]bool{6: true, 7: true}; !reflect.DeepEqual(got, want) {
		t.Fatalf("level 14: got %v, want %v", got, want)
	}
	if got := ArcanumOpen(g, 20); len(got) != 4 {
		t.Fatalf("level 20 opens all four, got %v", got)
	}
}

// The SRD Warlock declares its arcanum above its own pact ceiling, and a pool
// for each arcanum arriving at the same level — the cast and the pick agree.
func TestSeededWarlockArcanumMatchesItsPools(t *testing.T) {
	raw, err := srdFiles.ReadFile("srd/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var classes []entry
	if err := json.Unmarshal(raw, &classes); err != nil {
		t.Fatal(err)
	}
	for _, c := range classes {
		if c.Name != "Warlock" {
			continue
		}
		grants := ArcanumIn(c.Data)
		if len(grants) != 4 {
			t.Fatalf("expected four arcanum rows, got %v", grants)
		}
		pools := map[int]bool{}
		for _, p := range PoolsIn(c.Data) {
			pools[p.Level] = true
		}
		for _, g := range grants {
			if g.SpellLevel <= MaxSpellLevel("pact", g.Level) {
				t.Errorf("arcanum level %d at Warlock %d is within the pact ceiling", g.SpellLevel, g.Level)
			}
			if !pools[g.Level] {
				t.Errorf("no pool arrives with the level-%d arcanum at Warlock %d", g.SpellLevel, g.Level)
			}
		}
		return
	}
	t.Fatal("no SRD Warlock")
}
