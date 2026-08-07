package rules

import (
	"encoding/json"
	"testing"
)

// A Steel Defender as an Artificer pack would ship it: a monster entry whose
// numbers are expressions, because they follow the hero who built it.
const steelDefender = `{
  "size": "Medium", "type": "Construct", "ac": 15,
  "speed": "40 ft.",
  "abilities": {"str": 14, "dex": 12, "con": 14, "int": 4, "wis": 10, "cha": 6},
  "scale": {"hp": "2 + int + 5 * level"},
  "description": "**Deflect Attack.** ..."
}`

func TestResolveBlockScalesToTheHero(t *testing.T) {
	block, molded, err := ResolveBlock([]byte(steelDefender), nil, artificer())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if hp, ok := BlockHP(block); !ok || hp != 31 {
		t.Errorf("hit points = %d (ok=%v), want 31 for a level 5 Artificer with Int 18", hp, ok)
	}
	if _, present := block["scale"]; present {
		t.Error("the scale block is an authoring detail and should not reach the sheet")
	}
	if len(molded) != 0 {
		t.Errorf("nothing was molded, got %v", molded)
	}
}

func TestResolveBlockLetsThePlayerMoldOverTheBook(t *testing.T) {
	overrides := map[string]any{
		"hp":        44,
		"abilities": map[string]any{"str": 18},
	}
	block, molded, err := ResolveBlock([]byte(steelDefender), overrides, artificer())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if hp, _ := BlockHP(block); hp != 44 {
		t.Errorf("a molded value must beat the formula: hp = %d, want 44", hp)
	}
	if len(molded) != 2 {
		t.Errorf("molded = %v, want both fields named", molded)
	}
	// The five abilities the player did not touch survive the one they did.
	abilities, ok := block["abilities"].(map[string]any)
	if !ok {
		t.Fatal("abilities went missing")
	}
	if abilities["str"] != 18 {
		t.Errorf("str = %v, want the molded 18", abilities["str"])
	}
	if abilities["con"] != float64(14) {
		t.Errorf("con = %v, want the book's 14 — molding one ability must not blank the rest", abilities["con"])
	}
}

func TestResolveBlockSurvivesABadFormula(t *testing.T) {
	block, _, err := ResolveBlock([]byte(`{"ac": 15, "hp": 9, "scale": {"hp": "5 * wisdom"}}`), nil, artificer())
	if err == nil {
		t.Error("a formula naming nothing should be reported")
	}
	// Reported, but the sheet still loads with the unscaled number.
	if hp, _ := BlockHP(block); hp != 9 {
		t.Errorf("hp = %d, want the unscaled 9 to stand", hp)
	}
}

func TestResolveBlockWithNoContentIsPureOverrides(t *testing.T) {
	block, molded, err := ResolveBlock(nil, map[string]any{"hp": 7, "ac": 12}, artificer())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if hp, _ := BlockHP(block); hp != 7 || block["ac"] != 12 {
		t.Errorf("a hand-written creature is its overrides: %v", block)
	}
	if len(molded) != 2 {
		t.Errorf("molded = %v, want both", molded)
	}
}

// The Druid's Beast Shapes table, exactly as the SRD seed now declares it.
const wildShape = `{"forms": {
  "feature": "Wild Shape", "type": "Beast", "tempHp": "level",
  "table": [
    {"level": 2, "known": 4, "maxCR": 0.25, "fly": false},
    {"level": 4, "known": 6, "maxCR": 0.5,  "fly": false},
    {"level": 8, "known": 8, "maxCR": 1,    "fly": true}
  ]}}`

func TestFormsReadTheAllowanceAtALevel(t *testing.T) {
	_, forms := GrantsIn([]byte(wildShape))
	if forms == nil {
		t.Fatal("no forms declaration found")
	}

	if _, ok := forms.At(1, ScopeFor(1, nil)); ok {
		t.Error("a level 1 Druid has no Wild Shape yet")
	}

	at2, ok := forms.At(2, ScopeFor(2, nil))
	if !ok {
		t.Fatal("level 2 should reach the first row")
	}
	if at2.Known != 4 || at2.MaxCR != 0.25 || at2.Fly {
		t.Errorf("level 2 = %+v, want 4 known, CR 1/4, grounded", at2)
	}
	if at2.TempHP != 2 {
		t.Errorf("temp HP = %d, want the Druid's level", at2.TempHP)
	}

	// Between rows you keep the last one you reached, not the next one.
	at7, _ := forms.At(7, ScopeFor(7, nil))
	if at7.Known != 6 || at7.MaxCR != 0.5 || at7.Fly {
		t.Errorf("level 7 = %+v, want the level 4 row still standing", at7)
	}

	at12, _ := forms.At(12, ScopeFor(12, nil))
	if at12.Known != 8 || at12.MaxCR != 1 || !at12.Fly || at12.TempHP != 12 {
		t.Errorf("level 12 = %+v, want 8 known, CR 1, flight allowed", at12)
	}
}

func TestEligibleFormAppliesTypeCRAndFlight(t *testing.T) {
	_, forms := GrantsIn([]byte(wildShape))
	at2, _ := forms.At(2, ScopeFor(2, nil))
	at8, _ := forms.At(8, ScopeFor(8, nil))

	wolf := []byte(`{"type": "Beast", "crValue": 0.25, "speed": "40 ft."}`)
	eagle := []byte(`{"type": "Beast", "crValue": 0, "speed": "10 ft., Fly 60 ft."}`)
	direWolf := []byte(`{"type": "Beast", "crValue": 1, "speed": "50 ft."}`)
	imp := []byte(`{"type": "Fiend (Devil)", "crValue": 0.25, "speed": "20 ft."}`)

	if !at2.EligibleForm(wolf) {
		t.Error("a CR 1/4 Beast is the whole point of level 2")
	}
	if at2.EligibleForm(eagle) {
		t.Error("no Fly Speed before level 8")
	}
	if at2.EligibleForm(direWolf) {
		t.Error("CR 1 is over a level 2 Druid's ceiling")
	}
	if at2.EligibleForm(imp) {
		t.Error("Wild Shape is Beasts only")
	}
	if !at8.EligibleForm(eagle) || !at8.EligibleForm(direWolf) {
		t.Error("level 8 admits flight and CR 1")
	}
}

// Beast of the Land is a Beast printed at CR "None" — which reads as CR 0 and
// therefore sits under every Wild Shape ceiling there is. It is also a Ranger's
// Primal Companion, and a Druid turning into one is not a thing the rules allow.
// What separates it from a badger is that its numbers are written against a
// hero, so that is what the filter reads.
func TestAFormCannotBeSomebodyElsesCompanion(t *testing.T) {
	_, forms := GrantsIn([]byte(wildShape))
	at2, _ := forms.At(2, ScopeFor(2, nil))
	at20, _ := forms.At(20, ScopeFor(20, nil))

	primal := []byte(`{"type": "Beast", "crValue": 0, "speed": "40 ft., Climb 40 ft.",
	                   "scale": {"ac": "13 + wis", "hp": "5 + 5 * level"}}`)
	badger := []byte(`{"type": "Beast", "crValue": 0, "speed": "20 ft."}`)

	if at2.EligibleForm(primal) {
		t.Error("a Ranger's Primal Companion is not a Druid's Wild Shape form")
	}
	if at20.EligibleForm(primal) {
		t.Error("no level of Wild Shape admits a scaling companion block")
	}
	if !at2.EligibleForm(badger) {
		t.Error("an ordinary CR 0 Beast is still a form")
	}
}

func TestCompanionGrantsAreReadOffContent(t *testing.T) {
	companions, forms := GrantsIn([]byte(`{
	  "class": "Artificer",
	  "companions": [{"name": "Steel Defender", "role": "companion", "level": 3}]
	}`))
	if forms != nil {
		t.Error("a subclass granting a companion declares no forms")
	}
	if len(companions) != 1 || companions[0].Name != "Steel Defender" || companions[0].Level != 3 {
		t.Fatalf("companions = %+v", companions)
	}
}

func TestContentWithNoDeclarationsGrantsNothing(t *testing.T) {
	// Every entry in the library today, and it must stay silent.
	companions, forms := GrantsIn([]byte(`{"hitDie": 10, "saves": ["STR", "CON"]}`))
	if len(companions) != 0 || forms != nil {
		t.Errorf("plain content granted %v / %v", companions, forms)
	}
	if _, ok := forms.At(20, ScopeFor(20, nil)); ok {
		t.Error("a nil forms grant must be safe to read")
	}
}

func TestBlockHPReadsTheWaysBlocksWriteIt(t *testing.T) {
	cases := []struct {
		raw  string
		want int
		ok   bool
	}{
		{`{"hp": 31}`, 31, true},
		{`{"hp": "22 (4d8+4)"}`, 22, true},
		{`{"hp": "unknown"}`, 0, false},
		{`{}`, 0, false},
	}
	for _, tc := range cases {
		var block map[string]any
		if err := json.Unmarshal([]byte(tc.raw), &block); err != nil {
			t.Fatal(err)
		}
		got, ok := BlockHP(block)
		if got != tc.want || ok != tc.ok {
			t.Errorf("BlockHP(%s) = %d,%v want %d,%v", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}
