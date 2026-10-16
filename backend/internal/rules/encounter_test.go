package rules

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/*
The encounter maths, held to the contract the builder's meter is held to
(fixtures/rules/encounter-difficulty.json), plus the one claim worth checking
against the real Den: every creature it ships has a weight.
*/

type difficultyContract struct {
	XP []struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
		XP   int             `json:"xp"`
	} `json:"xp"`
	Budgets []struct {
		Levels []int  `json:"levels"`
		Budget Budget `json:"budget"`
	} `json:"budgets"`
	Bands []struct {
		Levels []int `json:"levels"`
		XP     int   `json:"xp"`
		Band   Band  `json:"band"`
	} `json:"bands"`
}

func TestEncounterDifficultyContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "fixtures", "rules", "encounter-difficulty.json"))
	if err != nil {
		t.Fatal(err)
	}
	var c difficultyContract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	for _, x := range c.XP {
		if got := MonsterXP(x.Data); got != x.XP {
			t.Errorf("xp %q: got %d, want %d", x.Name, got, x.XP)
		}
	}
	for _, b := range c.Budgets {
		if got := PartyBudget(b.Levels); got != b.Budget {
			t.Errorf("budget %v: got %+v, want %+v", b.Levels, got, b.Budget)
		}
	}
	for _, b := range c.Bands {
		if got := BandFor(b.XP, PartyBudget(b.Levels)); got != b.Band {
			t.Errorf("band %v @ %d: got %s, want %s", b.Levels, b.XP, got, b.Band)
		}
	}
}

func TestEveryShippedMonsterHasAWeight(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("srd", "monsters.json"))
	if err != nil {
		t.Fatal(err)
	}
	var den []struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &den); err != nil {
		t.Fatal(err)
	}
	for _, m := range den {
		var d struct {
			CRValue *float64 `json:"crValue"`
		}
		_ = json.Unmarshal(m.Data, &d)
		if MonsterXP(m.Data) == 0 && (d.CRValue == nil || *d.CRValue != 0) {
			t.Errorf("%s weighs nothing", m.Name)
		}
	}
}
