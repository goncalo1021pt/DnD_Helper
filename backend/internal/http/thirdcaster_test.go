package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

/*
Subclass-granted casting (#220). Fighter and Rogue are not casters — an
Eldritch Knight's spellcasting is declared on the SUBCLASS, and before this
plumbing existed the resolver read only class data, so a third-caster had no
slots at all, single-classed or not.
*/

// anEldritchKnight is a Fighter whose subclass declares third-caster casting
// off the Wizard list, the way phb24-delta.json ships it.
func anEldritchKnight(level int16) heroClass {
	name := "Eldritch Knight"
	k := aClass("Fighter", level, 0)
	k.SubclassID = pgtype.UUID{Bytes: uuid.New(), Valid: true}
	k.SubclassName = &name
	k.SubclassData = []byte(`{
		"class": "Fighter",
		"spellcaster": "third",
		"spellListClass": "Wizard",
		"spellcasting": {"ability": "INT",
			"cantrips": [0,0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
			"prepared": [0,0,3,4,4,4,5,6,6,7,8,8,9,10,10,11,11,11,12,13]}
	}`)
	return k
}

func TestCastingMayBeDeclaredOnTheSubclass(t *testing.T) {
	ek := anEldritchKnight(3)
	if got := castingDataOf(ek); string(got) != string(ek.SubclassData) {
		t.Error("a non-casting class with a casting subclass should cast off the subclass's data")
	}

	// The class's own declaration wins when it has one — a Wizard's tradition
	// must not displace the Wizard's table.
	wizard := aClass("Wizard", 3, 0)
	wizard.ClassData = []byte(`{"spellcaster": "full"}`)
	wizard.SubclassData = []byte(`{"spellcaster": "pact"}`)
	if got := castingDataOf(wizard); string(got) != string(wizard.ClassData) {
		t.Error("a casting class keeps its own declaration over its subclass's")
	}

	if got := castingDataOf(aClass("Fighter", 3, 0)); got != nil {
		t.Errorf("no casting anywhere should resolve to nil, got %s", got)
	}
}

func TestAnEldritchKnightHasThirdCasterSlots(t *testing.T) {
	casters := casterClassesOf([]heroClass{anEldritchKnight(3)})
	if len(casters) != 1 || casters[0].Kind != "third" || casters[0].Levels != 3 {
		t.Fatalf("casterClassesOf = %+v; want one third-caster at level 3", casters)
	}

	ability, slots, pact := spellSlotsFor(nil, []heroClass{anEldritchKnight(3)}, 3, nil, 0)
	if ability == nil || *ability != "INT" {
		t.Errorf("ability = %v; an Eldritch Knight casts off Intelligence", ability)
	}
	if pact != nil {
		t.Errorf("pact = %+v; third-casting is not Pact Magic", pact)
	}
	if slots == nil || len(*slots) != 1 || (*slots)[0].Level != 1 || (*slots)[0].Max != 2 {
		t.Errorf("slots = %+v; a lone EK 3 holds two level-1 slots", slots)
	}
}

func TestCastersOfReportsTheSubclassAbilityAndAllowances(t *testing.T) {
	ek := anEldritchKnight(3)
	out := castersOf([]heroClass{ek}, nil, pgtype.UUID{Bytes: ek.ClassID, Valid: true})
	if len(out) != 1 {
		t.Fatalf("castersOf found %d casters; want 1", len(out))
	}
	c := out[0]
	if c.Ability != "INT" || c.ClassName != "Fighter" {
		t.Errorf("caster = %s off %s; want Fighter off INT", c.ClassName, c.Ability)
	}
	if c.CantripsKnown == nil || *c.CantripsKnown != 2 {
		t.Errorf("cantrips = %v; an EK 3 knows 2", c.CantripsKnown)
	}
	if c.Prepared == nil || *c.Prepared != 3 {
		t.Errorf("prepared = %v; an EK 3 prepares 3", c.Prepared)
	}
	if c.MaxSpellLevel == nil || *c.MaxSpellLevel != 1 {
		t.Errorf("maxSpellLevel = %v; an EK 3 reaches level 1", c.MaxSpellLevel)
	}
}

// The spell list rides on data.spellListClass: an Eldritch Knight is a
// Fighter, and Fighter appears in no spell's classes array — Wizard does.
func TestSpellListClassBorrowsAnotherClasssList(t *testing.T) {
	cr := castingRules{Spellcaster: "third", SpellListClass: "Wizard"}
	fireball := spellData{Level: 3, Classes: []string{"Sorcerer", "Wizard"}}

	if !spellOnList(fireball, "Fireball", "Fighter", cr) {
		t.Error("a Wizard spell belongs on an Eldritch Knight's list")
	}
	if spellOnList(spellData{Level: 1, Classes: []string{"Cleric"}}, "Bless", "Fighter", cr) {
		t.Error("a Cleric-only spell does not")
	}
	if spellOnList(fireball, "Fireball", "Fighter", castingRules{Spellcaster: "third"}) {
		t.Error("without spellListClass a Fighter still has no list of its own")
	}
	if got := spellListName("Fighter", cr); got != "Wizard" {
		t.Errorf("refusals should name the %s list, got %s", "Wizard", got)
	}
}
