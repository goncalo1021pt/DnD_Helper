package http

import (
	"encoding/json"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

func TestPoolsShape(t *testing.T) {
	table := make([]interface{}, 20)
	for i := range table {
		table[i] = float64(2)
	}
	pool := func(fields map[string]interface{}) []interface{} {
		return []interface{}{fields}
	}
	cases := []struct {
		name    string
		pools   interface{}
		wantErr bool
	}{
		{name: "absent is fine — most content grants none", pools: nil},
		{name: "an expression pool passes", pools: pool(map[string]interface{}{"name": "Focus Points", "uses": "level", "level": float64(2), "shortRest": "all"})},
		{name: "a table pool passes", pools: pool(map[string]interface{}{"name": "Rages", "uses": table, "shortRest": "one"})},
		{name: "a nameless pool is refused", pools: pool(map[string]interface{}{"uses": "level"}), wantErr: true},
		{name: "a bad expression is refused at the door", pools: pool(map[string]interface{}{"name": "Broken", "uses": "level +"}), wantErr: true},
		{name: "a short table is refused — it would blank at high level", pools: pool(map[string]interface{}{"name": "Rages", "uses": table[:12]}), wantErr: true},
		{name: "uses of the wrong shape are refused", pools: pool(map[string]interface{}{"name": "Rages", "uses": map[string]interface{}{"x": 1}}), wantErr: true},
		{name: "the same pool twice is refused", pools: []interface{}{
			map[string]interface{}{"name": "Rages", "uses": "level"},
			map[string]interface{}{"name": "Rages", "uses": "prof"},
		}, wantErr: true},
		{name: "an unknown shortRest is refused", pools: pool(map[string]interface{}{"name": "Rages", "uses": "level", "shortRest": "sometimes"}), wantErr: true},
		{name: "a level off the sheet is refused", pools: pool(map[string]interface{}{"name": "Rages", "uses": "level", "level": float64(25)}), wantErr: true},
		{name: "pools must be a list", pools: map[string]interface{}{"Rages": "level"}, wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := map[string]interface{}{}
			if tc.pools != nil {
				data["pools"] = tc.pools
			}
			msg := validatePools(data)
			if tc.wantErr && msg == "" {
				t.Errorf("expected a rejection, got none")
			}
			if !tc.wantErr && msg != "" {
				t.Errorf("unexpected rejection: %s", msg)
			}
		})
	}
}

// The seed is held to the same validator a pack's homebrew faces, and the
// numbers a player would actually look up are spot-checked at their levels.
func TestSeededClassPoolsAreLegal(t *testing.T) {
	withPools := map[string]bool{
		"Barbarian": true, "Bard": true, "Cleric": true, "Druid": true,
		"Fighter": true, "Monk": true, "Paladin": true, "Ranger": true,
		"Sorcerer": true,
	}
	seen := 0
	for _, e := range seededClasses(t) {
		if msg := validatePools(e.Data); msg != "" {
			t.Errorf("%s: %s", e.Name, msg)
		}
		if _, ok := e.Data["pools"]; ok {
			if !withPools[e.Name] {
				t.Errorf("%s has pools the SRD does not give it", e.Name)
			}
			seen++
		} else if withPools[e.Name] {
			t.Errorf("%s should declare its pools", e.Name)
		}
	}
	if seen != len(withPools) {
		t.Errorf("expected %d classes with pools, got %d", len(withPools), seen)
	}
}

func TestSeededPoolsMatchTheSRD(t *testing.T) {
	// Pool name → level → expected maximum, for a hero with CHA 16.
	want := map[string]struct {
		pool   string
		level  int
		expect int
	}{
		"Barbarian": {"Rages", 5, 3},
		"Cleric":    {"Channel Divinity", 2, 2},
		"Druid":     {"Wild Shape", 1, 0}, // not before level 2
		"Fighter":   {"Second Wind", 10, 4},
		"Monk":      {"Focus Points", 11, 11},
		"Bard":      {"Bardic Inspiration", 4, 3}, // CHA 16 → +3
		"Sorcerer":  {"Sorcery Points", 20, 20},
	}
	for _, e := range seededClasses(t) {
		expect, ok := want[e.Name]
		if !ok {
			continue
		}
		raw, err := json.Marshal(e.Data)
		if err != nil {
			t.Fatal(err)
		}
		var found bool
		for _, grant := range rules.PoolsIn(raw) {
			if grant.Name != expect.pool {
				continue
			}
			found = true
			scope := rules.ScopeFor(expect.level, map[string]int{"cha": 16})
			if got := grant.Max(scope); got != expect.expect {
				t.Errorf("%s %s at level %d: expected %d, got %d",
					e.Name, expect.pool, expect.level, expect.expect, got)
			}
		}
		if !found {
			t.Errorf("%s does not declare %s", e.Name, expect.pool)
		}
	}

	// Lay On Hands is the one points-shaped pool: five times the level.
	for _, e := range seededClasses(t) {
		if e.Name != "Paladin" {
			continue
		}
		raw, _ := json.Marshal(e.Data)
		for _, grant := range rules.PoolsIn(raw) {
			if grant.Name == "Lay On Hands" {
				if got := grant.Max(rules.ScopeFor(7, nil)); got != 35 {
					t.Errorf("Lay On Hands at level 7: expected 35, got %d", got)
				}
			}
		}
	}
}
