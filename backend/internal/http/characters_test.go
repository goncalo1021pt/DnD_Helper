package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// A hero as the three creation paths leave them: the Forge records a class_id,
// the roster's quick-add sets table_born, and My Heroes' freeform form sets
// neither.
func forgedHero() db.Character {
	return db.Character{
		Name: "Vaelin", Class: "High Elf Wizard", Level: 5, HpMax: 32, HpCurrent: 32,
		ClassID: pgtype.UUID{Bytes: uuid.New(), Valid: true},
	}
}

func tableBornHero() db.Character {
	return db.Character{
		Name: "Grunk", Class: "Orc Barbarian", Level: 3, HpMax: 40, HpCurrent: 40,
		TableBorn: true,
	}
}

func accountQuickHero() db.Character {
	return db.Character{
		Name: "Nessa", Class: "Halfling Rogue", Level: 2, HpMax: 16, HpCurrent: 16,
	}
}

// inputFrom mirrors what the roster sends when only HP moved: the ± buttons
// resend name, class and level untouched.
func inputFrom(c db.Character) characterInput {
	return characterInput{
		name: c.Name, class: c.Class, level: c.Level,
		hpCurrent: c.HpCurrent, hpMax: c.HpMax,
	}
}

func TestHPIsNeverAnIdentityChange(t *testing.T) {
	for _, hero := range []struct {
		name string
		c    db.Character
	}{
		{"forged", forgedHero()},
		{"table-born", tableBornHero()},
		{"account quick-add", accountQuickHero()},
	} {
		for _, role := range []db.MembershipRole{db.MembershipRoleDm, db.MembershipRolePlayer} {
			in := inputFrom(hero.c)
			in.hpCurrent = 4
			in.hpMax = 44
			if got := amendRefusal(hero.c, in, role); got != "" {
				t.Errorf("%s hero, %s: taking damage was refused: %q", hero.name, role, got)
			}
		}
	}
}

func TestForgedHeroIdentityIsRefusedEvenToTheDM(t *testing.T) {
	hero := forgedHero()
	for _, tc := range []struct {
		field string
		apply func(*characterInput)
	}{
		{"name", func(in *characterInput) { in.name = "Someone Else" }},
		{"class", func(in *characterInput) { in.class = "Dwarf Barbarian" }},
		{"level", func(in *characterInput) { in.level = 12 }},
	} {
		for _, role := range []db.MembershipRole{db.MembershipRoleDm, db.MembershipRolePlayer} {
			in := inputFrom(hero)
			tc.apply(&in)
			if amendRefusal(hero, in, role) == "" {
				t.Errorf("a %s rewrote a forged hero's %s — the Forge owns it", role, tc.field)
			}
		}
	}
}

func TestOnlyTheDMAmendsATableBornHero(t *testing.T) {
	hero := tableBornHero()
	in := inputFrom(hero)
	in.name = "Grunk the Twice-Named"

	if got := amendRefusal(hero, in, db.MembershipRoleDm); got != "" {
		t.Errorf("the DM could not amend their own scribble: %q", got)
	}
	if amendRefusal(hero, in, db.MembershipRolePlayer) == "" {
		t.Error("a player renamed a table-born hero — that is the DM's to do")
	}
}

func TestAccountQuickHeroStaysTheOwnersToAmend(t *testing.T) {
	hero := accountQuickHero()
	in := inputFrom(hero)
	in.name = "Nessa Quickfingers"
	in.class = "Halfling Rogue (Thief)"
	in.level = 3

	// Unseated, so the caller carries no role at any table.
	if got := amendRefusal(hero, in, ""); got != "" {
		t.Errorf("an owner could not amend their own freeform hero: %q", got)
	}
}

func TestForgedBeatsTableBorn(t *testing.T) {
	// Belt and braces: a hero that somehow carries both marks is judged by the
	// sheet, so no role unlocks the wizard's fields.
	hero := forgedHero()
	hero.TableBorn = true
	in := inputFrom(hero)
	in.class = "Anything Else"

	if amendRefusal(hero, in, db.MembershipRoleDm) == "" {
		t.Error("table_born let the DM through to a forged hero's class")
	}
}
