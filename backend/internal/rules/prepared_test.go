package rules

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestPreparedAtReadsTheTableUpToTheLevel(t *testing.T) {
	grants := AlwaysPreparedIn([]byte(`{"alwaysPrepared":[
		{"level":3,"spells":["Burning Hands","Command"]},
		{"level":5,"spells":["Fireball","command"]}]}`))
	if got := PreparedAt(grants, 2); got != nil {
		t.Fatalf("below the first row nothing is granted, got %v", got)
	}
	if got, want := PreparedAt(grants, 3), []string{"Burning Hands", "Command"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("level 3: got %v, want %v", got, want)
	}
	// A name repeated in a later row is granted once, whatever its case.
	if got, want := PreparedAt(grants, 9), []string{"Burning Hands", "Command", "Fireball"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("level 9: got %v, want %v", got, want)
	}
	if AlwaysPreparedIn([]byte(`{"class":"Warlock"}`)) != nil {
		t.Fatal("content that declares nothing grants nothing")
	}
}

// Every always-prepared table the SRD ships names a spell the SRD has, at a
// level its class can already cast when the row arrives — a typo would grant
// nothing, silently, and a row too early would hand out a spell with no slot
// to cast it from.
func TestSeededAlwaysPreparedTablesAreLegal(t *testing.T) {
	read := func(file string) []entry {
		raw, err := srdFiles.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var out []entry
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	spellLevel := map[string]int{}
	for _, s := range read("srd/spells.json") {
		var d struct {
			Level int `json:"level"`
		}
		_ = json.Unmarshal(s.Data, &d)
		spellLevel[strings.ToLower(s.Name)] = d.Level
	}
	casterKind := map[string]string{}
	for _, c := range read("srd/classes.json") {
		var d struct {
			Spellcaster string `json:"spellcaster"`
		}
		_ = json.Unmarshal(c.Data, &d)
		casterKind[c.Name] = d.Spellcaster
	}

	tables := 0
	for _, sc := range read("srd/subclasses.json") {
		var d struct {
			Class string `json:"class"`
		}
		_ = json.Unmarshal(sc.Data, &d)
		grants := AlwaysPreparedIn(sc.Data)
		if len(grants) == 0 {
			continue
		}
		tables++
		for _, g := range grants {
			for _, name := range g.Spells {
				lvl, ok := spellLevel[strings.ToLower(name)]
				if !ok {
					t.Errorf("%s grants %q, which is not an SRD spell", sc.Name, name)
					continue
				}
				if max := MaxSpellLevel(casterKind[d.Class], g.Level); lvl > max {
					t.Errorf("%s grants %s (level %d) at %s %d, which casts up to level %d",
						sc.Name, name, lvl, d.Class, g.Level, max)
				}
			}
		}
	}
	if tables != 4 {
		t.Errorf("expected the four SRD subclasses with a fixed table, found %d", tables)
	}
}
