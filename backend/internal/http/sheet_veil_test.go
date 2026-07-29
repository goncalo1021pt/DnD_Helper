package http

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
)

func drawnVeil(revealed ...uuid.UUID) sheetVeil {
	v := sheetVeil{drawn: true, revealed: map[uuid.UUID]bool{}}
	for _, id := range revealed {
		v.revealed[id] = true
	}
	return v
}

func TestOpenTableConcealsNobody(t *testing.T) {
	v := sheetVeil{revealed: map[uuid.UUID]bool{}}
	hero, owner, other := uuid.New(), uuid.New(), uuid.New()

	if v.concealsFrom(hero, owner, other, false) {
		t.Error("with the veil down every sheet is open to the party")
	}
}

func TestVeiledTableConcealsOtherPlayersHeroes(t *testing.T) {
	hero, owner, other, dm := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	v := drawnVeil()

	if !v.concealsFrom(hero, owner, other, false) {
		t.Error("another player should see the name alone")
	}
	if v.concealsFrom(hero, owner, owner, false) {
		t.Error("a hero's own owner always reads their sheet")
	}
	if v.concealsFrom(hero, owner, dm, true) {
		t.Error("the DM reads the whole table")
	}
}

func TestRevealedHeroStepsOutOfTheVeil(t *testing.T) {
	shown, hidden := uuid.New(), uuid.New()
	owner, other := uuid.New(), uuid.New()
	v := drawnVeil(shown)

	if v.concealsFrom(shown, owner, other, false) {
		t.Error("a revealed hero's sheet is open to the party")
	}
	if !v.concealsFrom(hidden, owner, other, false) {
		t.Error("revealing one hero must not lift the veil off the rest")
	}
}

func TestConcealLeavesOnlyTheName(t *testing.T) {
	skills := []string{"Stealth"}
	full := api.Character{
		Id:          uuid.New(),
		OwnerUserId: uuid.New(),
		OwnerName:   "Ana",
		Name:        "Vex",
		Class:       "Half-Elf Rogue",
		Level:       7,
		HpCurrent:   31,
		HpMax:       44,
		CreatedAt:   time.Now(),
		Mine:        true,
		Sheet: &api.CharacterSheet{
			Abilities: api.AbilityScores{Str: 8, Dex: 18, Con: 14, Int: 12, Wis: 10, Cha: 16},
			Skills:    skills,
		},
	}
	xp, pending := 23000, 1
	full.Xp, full.PendingLevels = &xp, &pending

	got := conceal(full)

	if got.Name != "Vex" || got.OwnerName != "Ana" || got.Id != full.Id {
		t.Error("the name, the player behind it, and the identity survive the veil")
	}
	if got.Class != "" || got.Level != 0 || got.HpCurrent != 0 || got.HpMax != 0 {
		t.Errorf("numbers leaked through the veil: %+v", got)
	}
	if got.Sheet != nil || got.Xp != nil || got.PendingLevels != nil {
		t.Error("the sheet, XP and banked level-ups are not the party's to read")
	}
	if got.Concealed == nil || !*got.Concealed {
		t.Error("a concealed hero should say so")
	}
	if got.Mine {
		t.Error("a concealed hero is never the caller's own")
	}
}
