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

// Invocations count off the Warlock's table; Metamagic arrives at Sorcerer 2
// and grows by two at 10 and 17 (#384).
func TestInvocationsAndMetamagicAreAsked(t *testing.T) {
	warlock := heroClass{ClassID: uuid.New(), ClassName: "Warlock", ClassData: srdClass(t, "Warlock"), Level: 1}
	for level, want := range map[int16]int{1: 1, 2: 3, 5: 5, 20: 10} {
		warlock.Level = level
		inv := choiceByName(featureChoicesFor([]heroClass{warlock}, nil), "Eldritch Invocations")
		if inv == nil || inv.Count != want || inv.From == nil || *inv.From != "invocation" {
			t.Errorf("Warlock %d: want %d invocations, got %+v", level, want, inv)
		}
	}
	sorcerer := heroClass{ClassID: uuid.New(), ClassName: "Sorcerer", ClassData: srdClass(t, "Sorcerer"), Level: 1}
	if choiceByName(featureChoicesFor([]heroClass{sorcerer}, nil), "Metamagic") != nil {
		t.Error("Metamagic waits for Sorcerer 2")
	}
	for level, want := range map[int16]int{2: 2, 9: 2, 10: 4, 17: 6} {
		sorcerer.Level = level
		if m := choiceByName(featureChoicesFor([]heroClass{sorcerer}, nil), "Metamagic"); m == nil || m.Count != want {
			t.Errorf("Sorcerer %d: want %d Metamagic options, got %+v", level, want, m)
		}
	}
}

// The bookkeeping of a feat choice's answer (#384): adopt what no choice
// claims, refuse what another choice holds, repeat only what says it may.
func TestPlacingFeatPicks(t *testing.T) {
	rep := map[string]bool{"agonizing blast": true}

	// A Warlock who took Agonizing Blast at an ASI before the feature asked:
	// picking it claims that copy rather than adding a second.
	got, refused := placeFeatPicks([]string{"Alert", "Agonizing Blast"}, nil, nil, []string{"Agonizing Blast", "Pact of the Blade"}, rep)
	if refused != "" || len(got) != 1 || got[0] != "Pact of the Blade" {
		t.Errorf("adopt the orphan, append the rest: got %v %q", got, refused)
	}
	if feats := nextFeats([]string{"Alert", "Agonizing Blast"}, nil, got); len(feats) != 3 {
		t.Errorf("one copy each, got %v", feats)
	}

	// Another choice already holds Defense: the Champion may not take it twice.
	if _, refused := placeFeatPicks([]string{"Defense"}, nil, []string{"Defense"}, []string{"Defense"}, nil); refused != "Defense" {
		t.Errorf("a feat another choice holds is refused, got %q", refused)
	}

	// Repeatable: twice in one answer, both appended.
	got, refused = placeFeatPicks(nil, nil, nil, []string{"Agonizing Blast", "Agonizing Blast"}, rep)
	if refused != "" || len(got) != 2 {
		t.Errorf("a repeatable invocation sits twice, got %v %q", got, refused)
	}

	// A swap: the old answer leaves, the new one arrives, a kept pick stays once.
	old := []string{"Pact of the Blade", "Agonizing Blast", "Agonizing Blast"}
	hero := []string{"Alert", "Pact of the Blade", "Agonizing Blast", "Agonizing Blast"}
	got, _ = placeFeatPicks(hero, old, nil, []string{"Pact of the Blade", "Agonizing Blast", "Devil's Sight"}, rep)
	feats := nextFeats(hero, old, got)
	count := map[string]int{}
	for _, f := range feats {
		count[f]++
	}
	if count["Alert"] != 1 || count["Pact of the Blade"] != 1 || count["Agonizing Blast"] != 1 || count["Devil's Sight"] != 1 || len(feats) != 4 {
		t.Errorf("after the swap: %v", feats)
	}
}
