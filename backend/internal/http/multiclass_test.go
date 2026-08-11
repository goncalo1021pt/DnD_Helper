package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func aClass(name string, level int16, position int16) heroClass {
	return heroClass{
		CharacterID: uuid.New(),
		ClassID:     uuid.New(),
		Level:       level,
		Position:    position,
		ClassName:   name,
	}
}

func TestSingleClassedHeroReadsAsBefore(t *testing.T) {
	rogue := aClass("Rogue", 5, 0)

	if got := classLine([]heroClass{rogue}); got != "Rogue 5" {
		t.Errorf("classLine = %q; want \"Rogue 5\"", got)
	}
	if got := totalLevel([]heroClass{rogue}); got != 5 {
		t.Errorf("totalLevel = %d; want 5", got)
	}
}

func TestMulticlassedHeroReadsAsBothInOrderTaken(t *testing.T) {
	rogue, wizard := aClass("Rogue", 5, 0), aClass("Wizard", 3, 1)

	if got := classLine([]heroClass{rogue, wizard}); got != "Rogue 5 / Wizard 3" {
		t.Errorf("classLine = %q; want \"Rogue 5 / Wizard 3\"", got)
	}
	// The total is what proficiency bonus, XP and cantrip scaling key off, so
	// it is the sum and never either class's own level (PHB 2024, p.44).
	if got := totalLevel([]heroClass{rogue, wizard}); got != 8 {
		t.Errorf("totalLevel = %d; want 8", got)
	}
}

// A quick-add hero has no class content at all — only a freeform line — and
// must not be given an empty multiclass display to render.
func TestQuickAddHeroHasNoClassLine(t *testing.T) {
	if got := classLine(nil); got != "" {
		t.Errorf("classLine = %q; want empty", got)
	}
	if got := totalLevel(nil); got != 0 {
		t.Errorf("totalLevel = %d; want 0", got)
	}
}

// `starting` answers "which class grants full starting proficiencies", and
// that is characters.class_id — not whichever row happens to sort first.
func TestStartingClassIsTheOneOnTheCharacterRow(t *testing.T) {
	rogue, wizard := aClass("Rogue", 5, 0), aClass("Wizard", 3, 1)
	startedAsWizard := pgtype.UUID{Bytes: wizard.ClassID, Valid: true}

	out := toAPICharacterClasses([]heroClass{rogue, wizard}, startedAsWizard)
	if len(out) != 2 {
		t.Fatalf("got %d classes; want 2", len(out))
	}
	if out[0].Starting == nil || *out[0].Starting {
		t.Error("the Rogue rows first but is not what they started as")
	}
	if out[1].Starting == nil || !*out[1].Starting {
		t.Error("the Wizard is the starting class and should say so")
	}
}

// A quick-add hero has no class_id, so nothing claims to be the starting class.
func TestNoStartingClassWhenTheCharacterHasNoClassID(t *testing.T) {
	out := toAPICharacterClasses([]heroClass{aClass("Rogue", 3, 0)}, pgtype.UUID{})

	if out[0].Starting == nil || *out[0].Starting {
		t.Error("with no class_id on the row, no class is the starting one")
	}
}

func TestSubclassBelongsToItsOwnClass(t *testing.T) {
	thief := "Thief"
	rogue := aClass("Rogue", 5, 0)
	rogue.SubclassID = pgtype.UUID{Bytes: uuid.New(), Valid: true}
	rogue.SubclassName = &thief
	wizard := aClass("Wizard", 3, 1) // no subclass yet — Wizard picks at 3

	out := toAPICharacterClasses([]heroClass{rogue, wizard}, pgtype.UUID{})
	if out[0].SubclassName == nil || *out[0].SubclassName != "Thief" {
		t.Error("the Rogue keeps their archetype")
	}
	if out[1].SubclassId != nil || out[1].SubclassName != nil {
		t.Error("the Wizard's empty subclass must not borrow the Rogue's")
	}
}

// A bulk roster read comes back as one flat list; each hero must get their own
// classes and nobody else's.
func TestBulkReadGroupsClassesByHero(t *testing.T) {
	vex, harkon := uuid.New(), uuid.New()
	rows := []heroClass{
		{CharacterID: vex, ClassID: uuid.New(), ClassName: "Rogue", Level: 5},
		{CharacterID: harkon, ClassID: uuid.New(), ClassName: "Fighter", Level: 8},
		{CharacterID: vex, ClassID: uuid.New(), ClassName: "Wizard", Level: 3, Position: 1},
	}

	grouped := byCharacter(rows)
	if got := classLine(grouped[vex]); got != "Rogue 5 / Wizard 3" {
		t.Errorf("Vex reads %q; want \"Rogue 5 / Wizard 3\"", got)
	}
	if got := classLine(grouped[harkon]); got != "Fighter 8" {
		t.Errorf("Harkon reads %q; want \"Fighter 8\"", got)
	}
	if got := len(grouped[uuid.New()]); got != 0 {
		t.Errorf("a hero with no rows should group to nothing; got %d", got)
	}
}
