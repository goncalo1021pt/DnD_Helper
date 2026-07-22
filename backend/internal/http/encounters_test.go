package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

func TestHPState(t *testing.T) {
	tests := []struct {
		cur, max int32
		want     string
	}{
		{10, 10, "healthy"},
		{6, 10, "healthy"},
		{5, 10, "bloodied"}, // exactly half is bloodied
		{1, 10, "bloodied"},
		{0, 10, "down"},
		{-4, 10, "down"},
		{0, 0, "down"},
		{5, 0, "healthy"}, // unknown max: never "bloodied", but alive
	}
	for _, tc := range tests {
		if got := hpState(tc.cur, tc.max); got != tc.want {
			t.Errorf("hpState(%d,%d) = %q; want %q", tc.cur, tc.max, got, tc.want)
		}
	}
}

// The player payload must never leak an enemy's real name, exact HP, or AC.
func TestCombatantForPlayerRedactsEnemies(t *testing.T) {
	enemy := db.EncounterCombatant{
		ID:          uuid.New(),
		EncounterID: uuid.New(),
		Kind:        "monster",
		Label:       "Ancient Red Dragon", // the DM's true name — must NOT appear
		PlayerLabel: "Looming Shape",       // what players are allowed to see
		InitMod:     3,
		HpCurrent:   40,
		HpMax:       100,
		Ac:          22,
		Hidden:      true,
	}

	out := combatantForPlayer(enemy, false /*mine*/, false /*current*/)

	if out.Name != "Looming Shape" {
		t.Errorf("Name = %q; want the reveal label, not the true name", out.Name)
	}
	if out.HpCurrent != nil || out.HpMax != nil || out.Ac != nil {
		t.Error("exact HP/AC must be nil for an enemy in the player view")
	}
	if out.IsMine != nil {
		t.Error("IsMine must be unset for an enemy")
	}
	if out.CharacterId != nil {
		t.Error("CharacterId must be unset for an enemy")
	}
	if out.PlayerLabel != nil {
		t.Error("PlayerLabel is a DM-only field and must be nil in the player view")
	}
	if out.Hidden {
		t.Error("Hidden must be forced false in player payloads (it is a DM-only signal)")
	}
	if out.HpState != "bloodied" { // 40 of 100
		t.Errorf("HpState = %q; want the coarse cue 'bloodied'", out.HpState)
	}
}

func TestCombatantForPlayerUnnamedEnemyIsUnknown(t *testing.T) {
	enemy := db.EncounterCombatant{
		ID: uuid.New(), EncounterID: uuid.New(),
		Kind: "monster", Label: "Goblin", PlayerLabel: "   ", // blank reveal label
	}
	if out := combatantForPlayer(enemy, false, false); out.Name != "Unknown" {
		t.Errorf("Name = %q; want %q for an enemy with no reveal label", out.Name, "Unknown")
	}
}

func TestCombatantForPlayerOwnPCSeesNumbers(t *testing.T) {
	charID := uuid.New()
	pc := db.EncounterCombatant{
		ID:          uuid.New(),
		EncounterID: uuid.New(),
		Kind:        "pc",
		Label:       "Kael",
		CharacterID: pgtype.UUID{Bytes: charID, Valid: true},
		HpCurrent:   18,
		HpMax:       24,
		Ac:          16,
	}

	out := combatantForPlayer(pc, true /*mine*/, true /*current*/)

	if out.Name != "Kael" {
		t.Errorf("Name = %q; want the PC's real name", out.Name)
	}
	if out.HpCurrent == nil || *out.HpCurrent != 18 {
		t.Errorf("HpCurrent = %v; want 18 for the owner", out.HpCurrent)
	}
	if out.HpMax == nil || *out.HpMax != 24 {
		t.Errorf("HpMax = %v; want 24 for the owner", out.HpMax)
	}
	if out.Ac == nil || *out.Ac != 16 {
		t.Errorf("Ac = %v; want 16 for the owner", out.Ac)
	}
	if out.IsMine == nil || !*out.IsMine {
		t.Error("IsMine must be true for the viewer's own PC")
	}
	if out.CharacterId == nil || [16]byte(*out.CharacterId) != [16]byte(charID) {
		t.Error("CharacterId must be exposed for the viewer's own PC")
	}
	if !out.Current {
		t.Error("Current should reflect the passed value")
	}
}

// A fellow party member's PC: real name is shared, but not their HP numbers.
func TestCombatantForPlayerOtherPCHidesNumbers(t *testing.T) {
	pc := db.EncounterCombatant{
		ID: uuid.New(), EncounterID: uuid.New(),
		Kind: "pc", Label: "Briv.", HpCurrent: 5, HpMax: 30, Ac: 14,
	}
	out := combatantForPlayer(pc, false /*mine*/, false)
	if out.Name != "Briv." {
		t.Errorf("Name = %q; want the party member's real name %q", out.Name, "Briv.")
	}
	if out.HpCurrent != nil || out.HpMax != nil || out.Ac != nil {
		t.Error("a non-owned PC must not expose exact HP/AC")
	}
	if out.IsMine != nil {
		t.Error("IsMine must be unset for a PC that isn't the viewer's")
	}
	if out.HpState != "bloodied" { // 5 of 30
		t.Errorf("HpState = %q; want 'bloodied'", out.HpState)
	}
}
