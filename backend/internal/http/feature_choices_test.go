package http

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// The SRD's classes and subclasses pass the door a pack would, choices and all
// (#382) — a choice the validator would refuse must not ship in the seed.
func TestSRDClassesAreLegalContent(t *testing.T) {
	for file, kind := range map[string]db.ContentKind{
		"srd/classes.json":    db.ContentKindClass,
		"srd/subclasses.json": db.ContentKindSubclass,
	} {
		raw, err := rules.SRDFile(file)
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
		for _, e := range entries {
			if msg := validateContentData(kind, e.Data); msg != "" {
				t.Errorf("%s: %s", e.Name, msg)
			}
		}
	}
}

func srdClass(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := rules.SRDFile("srd/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name == name {
			return e.Data
		}
	}
	t.Fatalf("no SRD class %s", name)
	return nil
}

func choiceByName(choices []api.FeatureChoice, feature string) *api.FeatureChoice {
	for i := range choices {
		if choices[i].Feature == feature {
			return &choices[i]
		}
	}
	return nil
}

// The Fighter from the table: a Fighting Style owed from level 1, its Weapon
// Mastery counted off the class table as it grows.
func TestAFighterIsOwedAStyle(t *testing.T) {
	fighter := heroClass{ClassID: uuid.New(), ClassName: "Fighter", ClassData: srdClass(t, "Fighter"), Level: 1}

	choices := featureChoicesFor([]heroClass{fighter}, nil)
	style := choiceByName(choices, "Fighting Style")
	if style == nil {
		t.Fatal("a Fighter 1 must be asked for a Fighting Style")
	}
	if style.Type != api.FeatureChoiceTypeFeat || style.From == nil || *style.From != "fighting-style" || style.Count != 1 {
		t.Errorf("Fighting Style should be one fighting-style feat, got %+v", style)
	}
	if style.Swap == nil || *style.Swap != api.Levelup {
		t.Error("a Fighter may change their style as they rise")
	}
	if len(style.Picked) != 0 {
		t.Error("nothing is backfilled")
	}
	if m := choiceByName(choices, "Weapon Mastery"); m == nil || m.Count != 3 {
		t.Errorf("Weapon Mastery at Fighter 1 is three kinds, got %+v", m)
	}

	fighter.Level = 10
	stored := map[string][]string{style.Key: {"Defense"}}
	choices = featureChoicesFor([]heroClass{fighter}, stored)
	if m := choiceByName(choices, "Weapon Mastery"); m == nil || m.Count != 5 {
		t.Errorf("Weapon Mastery at Fighter 10 is five kinds, got %+v", m)
	}
	if got := choiceByName(choices, "Fighting Style").Picked; len(got) != 1 || got[0] != "Defense" {
		t.Errorf("the stored style comes back, got %v", got)
	}
}

// Read at the level in each class: a Wizard 5 / Fighter 1 owes the Fighter's
// level-1 picks and the Wizard's Scholar, and a Paladin's style waits for 2.
func TestChoicesAreReadPerClass(t *testing.T) {
	wizard := heroClass{ClassID: uuid.New(), ClassName: "Wizard", ClassData: srdClass(t, "Wizard"), Level: 5}
	fighter := heroClass{ClassID: uuid.New(), ClassName: "Fighter", ClassData: srdClass(t, "Fighter"), Level: 1}
	choices := featureChoicesFor([]heroClass{wizard, fighter}, nil)
	if choiceByName(choices, "Scholar") == nil || choiceByName(choices, "Fighting Style") == nil {
		t.Errorf("both classes ask, got %d choices", len(choices))
	}

	paladin := heroClass{ClassID: uuid.New(), ClassName: "Paladin", ClassData: srdClass(t, "Paladin"), Level: 1}
	if choiceByName(featureChoicesFor([]heroClass{paladin}, nil), "Fighting Style") != nil {
		t.Error("a Paladin's style arrives at Paladin 2, not 1")
	}
	paladin.Level = 2
	style := choiceByName(featureChoicesFor([]heroClass{paladin}, nil), "Fighting Style")
	if style == nil || len(style.Options) != 1 || style.Options[0].Name != "Blessed Warrior" {
		t.Errorf("a Paladin may take Blessed Warrior instead, got %+v", style)
	}
}

// Expertise grows with the class where the book says so in prose (Rogue 6),
// and a Protector's option carries the weapons it trains.
func TestChoiceCountsAndGrants(t *testing.T) {
	rogue := heroClass{ClassID: uuid.New(), ClassName: "Rogue", ClassData: srdClass(t, "Rogue"), Level: 5}
	if e := choiceByName(featureChoicesFor([]heroClass{rogue}, nil), "Expertise"); e == nil || e.Count != 2 {
		t.Errorf("Rogue 5 has two Expertise, got %+v", e)
	}
	rogue.Level = 6
	if e := choiceByName(featureChoicesFor([]heroClass{rogue}, nil), "Expertise"); e == nil || e.Count != 4 {
		t.Errorf("Rogue 6 has four Expertise, got %+v", e)
	}

	cleric := heroClass{ClassID: uuid.New(), ClassName: "Cleric", ClassData: srdClass(t, "Cleric"), Level: 1}
	order := choiceByName(featureChoicesFor([]heroClass{cleric}, nil), "Divine Order")
	if order == nil || len(order.Options) != 2 {
		t.Fatalf("Divine Order offers two roles, got %+v", order)
	}
	if w := order.Options[0].Weapons; w == nil || (*w)[0] != "Martial" {
		t.Errorf("a Protector is trained in Martial weapons, got %+v", order.Options[0])
	}

	stored := map[string][]string{
		choiceKey(rogue.ClassID.String(), "expertise"): {"Stealth", "Acrobatics"},
	}
	rogue.Level = 1
	if got := expertiseOf(featureChoicesFor([]heroClass{rogue}, stored)); len(got) != 2 || got[0] != "Acrobatics" {
		t.Errorf("expertise is read off the picks, got %v", got)
	}
}

// A subclass's choice is keyed by the subclass, so it never collides with its
// class's own — a Champion's second style beside the Fighter's first.
func TestASubclassAsksUnderItsOwnKey(t *testing.T) {
	sub := uuid.New()
	name := "Champion"
	fighter := heroClass{
		ClassID: uuid.New(), ClassName: "Fighter", ClassData: srdClass(t, "Fighter"), Level: 7,
		SubclassID: pgtype.UUID{Bytes: sub, Valid: true}, SubclassName: &name,
		SubclassData: []byte(`{"class":"Fighter","features":[{"level":7,"name":"Additional Fighting Style","choice":{"id":"additional-fighting-style","type":"feat","from":"fighting-style"}}]}`),
	}
	extra := choiceByName(featureChoicesFor([]heroClass{fighter}, nil), "Additional Fighting Style")
	if extra == nil || extra.Key != choiceKey(sub.String(), "additional-fighting-style") || extra.Source != "Champion" {
		t.Errorf("the Champion asks under its own key, got %+v", extra)
	}
}

func TestFeatureChoiceValidation(t *testing.T) {
	cases := map[string]string{
		"no type":             `{"id":"x"}`,
		"unknown type":        `{"id":"x","type":"skills"}`,
		"a colon in the id":   `{"id":"a:b","type":"mastery"}`,
		"a bad swap":          `{"id":"x","type":"mastery","swap":"whenever"}`,
		"a missing table":     `{"id":"x","type":"mastery","chooseTable":"Nope"}`,
		"a short level table": `{"id":"x","type":"expertise","choose":[1,2,3]}`,
		"a feat from nowhere": `{"id":"x","type":"feat"}`,
		"an option of one":    `{"id":"x","type":"option","options":[{"name":"Only"}]}`,
		"an unknown skill":    `{"id":"x","type":"expertise","options":[{"name":"Juggling"}]}`,
	}
	for name, choice := range cases {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(`{"features":[{"level":1,"name":"F","choice":`+choice+`}]}`), &data); err != nil {
			t.Fatal(err)
		}
		if msg := validateFeatureChoices(data); msg == "" {
			t.Errorf("%s: should be refused", name)
		}
	}
	var good map[string]interface{}
	_ = json.Unmarshal([]byte(`{"featuresTable":[{"name":"Picks","values":["1"]}],"features":[
		{"level":1,"name":"A","choice":{"id":"a","type":"mastery","chooseTable":"Picks","swap":"rest"}},
		{"level":2,"name":"B","choice":{"id":"b","type":"feat","from":"fighting-style","options":[{"name":"Blessed Warrior"}]}}
	]}`), &good)
	if msg := validateFeatureChoices(good); msg != "" {
		t.Errorf("a good declaration is refused: %s", msg)
	}
}
