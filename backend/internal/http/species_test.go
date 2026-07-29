package http

import (
	"encoding/json"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// gnome is the shape the SRD seed ships: one lineage plus the ability its
// spells use.
func gnome() speciesRules {
	return speciesRules{
		Size:  "Small",
		Speed: 30,
		Choices: []speciesChoice{
			{
				ID: "lineage", Name: "Gnomish Lineage", Type: "lineage", Choose: 1,
				Options: []speciesChoiceOption{{Name: "Forest Gnome"}, {Name: "Rock Gnome"}},
			},
			{
				ID: "lineage-ability", Name: "Lineage Spellcasting Ability", Type: "ability", Choose: 1,
				Options: []speciesChoiceOption{{Name: "Intelligence"}, {Name: "Wisdom"}, {Name: "Charisma"}},
			},
		},
	}
}

func TestResolveSpeciesChoicesStoresPicks(t *testing.T) {
	got, msg := resolveSpeciesChoices(gnome(), "Gnome", map[string][]string{
		"lineage":         {"Rock Gnome"},
		"lineage-ability": {"Intelligence"},
	}, nil)
	if msg != "" {
		t.Fatalf("unexpected rejection: %s", msg)
	}
	if len(got.Stored["lineage"]) != 1 || got.Stored["lineage"][0] != "Rock Gnome" {
		t.Errorf("lineage not stored: %v", got.Stored)
	}
	if len(got.Skills) != 0 || len(got.Feats) != 0 {
		t.Errorf("a lineage grants no proficiencies, got skills=%v feats=%v", got.Skills, got.Feats)
	}
}

func TestResolveSpeciesChoicesRequiresEveryChoice(t *testing.T) {
	// A Gnome with no lineage is missing two cantrips — half-built is not legal.
	if _, msg := resolveSpeciesChoices(gnome(), "Gnome", nil, nil); msg == "" {
		t.Fatal("expected a missing-lineage rejection")
	}
	if _, msg := resolveSpeciesChoices(gnome(), "Gnome", map[string][]string{
		"lineage": {"Rock Gnome"},
	}, nil); msg == "" {
		t.Fatal("expected a rejection when only one of two choices is answered")
	}
}

func TestResolveSpeciesChoicesRejectsUnknownOptions(t *testing.T) {
	cases := map[string]map[string][]string{
		"option off the list": {"lineage": {"Deep Gnome"}, "lineage-ability": {"Wisdom"}},
		"choice off the list": {"lineage": {"Rock Gnome"}, "lineage-ability": {"Wisdom"}, "wings": {"Yes"}},
		"too many picks":      {"lineage": {"Rock Gnome", "Forest Gnome"}, "lineage-ability": {"Wisdom"}},
	}
	for name, picks := range cases {
		if _, msg := resolveSpeciesChoices(gnome(), "Gnome", picks, nil); msg == "" {
			t.Errorf("%s: expected a rejection", name)
		}
	}
}

func TestResolveSpeciesChoicesGrantsSkillsAndFeats(t *testing.T) {
	human := speciesRules{
		Size: "Medium or Small", Speed: 30,
		Choices: []speciesChoice{
			{ID: "size", Name: "Size", Type: "size", Choose: 1,
				Options: []speciesChoiceOption{{Name: "Medium"}, {Name: "Small"}}},
			{ID: "skillful", Name: "Skillful", Type: "skill", Choose: 1, From: "*"},
			{ID: "versatile", Name: "Versatile", Type: "feat", Choose: 1, From: "origin"},
		},
	}
	got, msg := resolveSpeciesChoices(human, "Human", map[string][]string{
		"size":      {"Small"},
		"skillful":  {"Perception"},
		"versatile": {"Skilled"},
	}, nil)
	if msg != "" {
		t.Fatalf("unexpected rejection: %s", msg)
	}
	if len(got.Skills) != 1 || got.Skills[0] != "Perception" {
		t.Errorf("Skillful should grant a skill, got %v", got.Skills)
	}
	if len(got.Feats) != 1 || got.Feats[0] != "Skilled" {
		t.Errorf("Versatile should grant a feat, got %v", got.Feats)
	}
	// A size pick is recorded but grants nothing mechanical.
	if len(got.Stored["size"]) != 1 {
		t.Errorf("size not stored: %v", got.Stored)
	}
}

func TestResolveSpeciesChoicesRejectsDuplicateSkill(t *testing.T) {
	elf := speciesRules{
		Size: "Medium", Speed: 30,
		Choices: []speciesChoice{{
			ID: "keen-senses", Name: "Keen Senses", Type: "skill", Choose: 1,
			Options: []speciesChoiceOption{{Name: "Insight"}, {Name: "Perception"}, {Name: "Survival"}},
		}},
	}
	// The background already granted Perception; taking it twice buys nothing.
	_, msg := resolveSpeciesChoices(elf, "Elf", map[string][]string{
		"keen-senses": {"Perception"},
	}, map[string]bool{"Perception": true})
	if msg == "" {
		t.Fatal("expected a duplicate-skill rejection")
	}
	// The other options remain fine.
	if _, msg := resolveSpeciesChoices(elf, "Elf", map[string][]string{
		"keen-senses": {"Survival"},
	}, map[string]bool{"Perception": true}); msg != "" {
		t.Fatalf("unexpected rejection: %s", msg)
	}
}

func TestValidateSpeciesChoices(t *testing.T) {
	valid := func(choice string) map[string]interface{} {
		var c interface{}
		if err := json.Unmarshal([]byte(choice), &c); err != nil {
			t.Fatal(err)
		}
		return map[string]interface{}{"size": "Medium", "speed": float64(30), "choices": []interface{}{c}}
	}
	bad := map[string]string{
		"no id":            `{"name":"Lineage","type":"lineage","options":[{"name":"A"}]}`,
		"unknown type":     `{"id":"x","name":"Lineage","type":"skills","options":[{"name":"Insight"}]}`,
		"no options":       `{"id":"x","name":"Lineage","type":"lineage"}`,
		"choose > options": `{"id":"x","name":"L","type":"lineage","choose":3,"options":[{"name":"A"},{"name":"B"}]}`,
		"unknown skill":    `{"id":"x","name":"Senses","type":"skill","options":[{"name":"Juggling"}]}`,
		"repeated option":  `{"id":"x","name":"L","type":"lineage","options":[{"name":"A"},{"name":"A"}]}`,
	}
	for name, choice := range bad {
		if msg := validateSpeciesChoices(valid(choice)); msg == "" {
			t.Errorf("%s: expected a validation error", name)
		}
	}
	ok := map[string]string{
		"explicit options": `{"id":"x","name":"L","type":"lineage","choose":1,"options":[{"name":"A"},{"name":"B"}]}`,
		"any skill":        `{"id":"x","name":"Skillful","type":"skill","choose":1,"from":"*"}`,
		"any origin feat":  `{"id":"x","name":"Versatile","type":"feat","choose":1,"from":"origin"}`,
	}
	for name, choice := range ok {
		if msg := validateSpeciesChoices(valid(choice)); msg != "" {
			t.Errorf("%s: unexpected error %q", name, msg)
		}
	}
	// A species with no choices at all is perfectly valid — most have none.
	if msg := validateSpeciesChoices(map[string]interface{}{"size": "Medium", "speed": float64(30)}); msg != "" {
		t.Errorf("choiceless species rejected: %s", msg)
	}
}

// The shipped SRD data has to satisfy the validator it will be seeded through,
// and every trait that says "choose" has to point at a choice that exists.
func TestSeededSRDSpeciesAreValid(t *testing.T) {
	raw, err := rules.SRDFile("srd/species.json")
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
	if len(entries) == 0 {
		t.Fatal("no species seeded")
	}
	for _, e := range entries {
		if msg := validateContentData(db.ContentKindSpecies, e.Data); msg != "" {
			t.Errorf("%s: %s", e.Name, msg)
		}
		var sr speciesRules
		blob, _ := json.Marshal(e.Data)
		if err := json.Unmarshal(blob, &sr); err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		ids := map[string]bool{}
		for _, c := range sr.Choices {
			ids[c.ID] = true
		}
		for _, tr := range sr.Traits {
			if tr.Choice != "" && !ids[tr.Choice] {
				t.Errorf("%s: trait %q points at missing choice %q", e.Name, tr.Name, tr.Choice)
			}
		}
	}
}
