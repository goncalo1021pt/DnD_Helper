package http

import (
	"encoding/json"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// twenty builds a column of the given value repeated for every level — the
// shape is what these tests are about, not the numbers.
func twenty(v interface{}) []interface{} {
	out := make([]interface{}, featuresTableLevels)
	for i := range out {
		out[i] = v
	}
	return out
}

func column(name string, values []interface{}) map[string]interface{} {
	return map[string]interface{}{"name": name, "values": values}
}

func TestFeaturesTableShape(t *testing.T) {
	cases := []struct {
		name    string
		table   interface{}
		wantErr bool
	}{
		{name: "absent is fine — the Wizard has no column of its own", table: nil},
		{name: "a full column passes", table: []interface{}{column("Sneak Attack", twenty("1d6"))}},
		{name: "numbers are as welcome as text", table: []interface{}{column("Rages", twenty(float64(2)))}},
		{
			name:    "a short column is refused — it would be a blank box at high level",
			table:   []interface{}{column("Rages", twenty("2")[:12])},
			wantErr: true,
		},
		{
			name:    "a nameless column is refused",
			table:   []interface{}{column("", twenty("2"))},
			wantErr: true,
		},
		{
			name:    "two columns with one name is refused",
			table:   []interface{}{column("Rages", twenty("2")), column("Rages", twenty("3"))},
			wantErr: true,
		},
		{
			name:    "values must be readable, not objects",
			table:   []interface{}{column("Rages", twenty(map[string]interface{}{"x": 1}))},
			wantErr: true,
		},
		{name: "the table itself must be a list", table: map[string]interface{}{"Rages": []interface{}{}}, wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := map[string]interface{}{}
			if tc.table != nil {
				data["featuresTable"] = tc.table
			}
			msg := validateFeaturesTable(data)
			if tc.wantErr && msg == "" {
				t.Errorf("expected a rejection, got none")
			}
			if !tc.wantErr && msg != "" {
				t.Errorf("unexpected rejection: %s", msg)
			}
		})
	}
}

// The seed is the data a real table reads, so it is the thing worth checking:
// every column the SRD prints, spanning every level a hero can reach, and held
// to exactly the rules the API enforces on a pack's homebrew class.
func seededClasses(t *testing.T) []struct {
	Name string                 `json:"name"`
	Data map[string]interface{} `json:"data"`
} {
	t.Helper()
	raw, err := rules.SRDFile("srd/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []struct {
		Name string                 `json:"name"`
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestSeededClassTablesAreWholeAndLegal(t *testing.T) {
	entries := seededClasses(t)
	if len(entries) != 12 {
		t.Fatalf("expected the twelve SRD classes, got %d", len(entries))
	}

	// Every class whose features cite a table must have one. The Wizard is the
	// deliberate exception: its only columns are spell counts, which live in
	// `spellcasting` already.
	withTable := 0
	for _, e := range entries {
		if msg := validateFeaturesTable(e.Data); msg != "" {
			t.Errorf("%s: %s", e.Name, msg)
		}
		if _, ok := e.Data["featuresTable"]; ok {
			withTable++
		} else if e.Name != "Wizard" {
			t.Errorf("%s has no features table", e.Name)
		}
	}
	if withTable != 11 {
		t.Errorf("expected 11 classes with a table, got %d", withTable)
	}
}

// The columns the reported bug named, spot-checked at the levels a player would
// have looked up: a level 3 Rogue's Sneak Attack die, and a level 1 Barbarian's
// Rages. Those two are what the playtest actually opened the book over.
func TestSeededColumnsMatchTheSRD(t *testing.T) {
	want := map[string]struct {
		column string
		level  int
		value  string
	}{
		"Rogue":     {"Sneak Attack", 3, "2d6"},
		"Barbarian": {"Rages", 1, "2"},
		"Monk":      {"Martial Arts", 11, "1d10"},
	}

	for _, e := range seededClasses(t) {
		expect, ok := want[e.Name]
		if !ok {
			continue
		}
		found := false
		for _, item := range e.Data["featuresTable"].([]interface{}) {
			col := item.(map[string]interface{})
			if col["name"] != expect.column {
				continue
			}
			found = true
			if got := col["values"].([]interface{})[expect.level-1]; got != expect.value {
				t.Errorf("%s %s at level %d: got %v, want %s", e.Name, expect.column, expect.level, got, expect.value)
			}
		}
		if !found {
			t.Errorf("%s has no %s column", e.Name, expect.column)
		}
	}
}
