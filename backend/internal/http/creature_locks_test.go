package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// A grant's name means the SRD's entry first, then the monster its own author
// shipped beside it, then the hero owner's (#378).
func TestMonsterNamedPrefersTheGrantsOwnAuthor(t *testing.T) {
	packAuthor, owner, stranger := uuid.New(), uuid.New(), uuid.New()
	by := func(who uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: who, Valid: true} }
	hound := func(who uuid.UUID) db.RulesContent {
		return db.RulesContent{ID: uuid.New(), Name: "Steel Defender", Source: db.ContentSourceHomebrew, CreatedBy: by(who)}
	}
	strangers, owners, packs := hound(stranger), hound(owner), hound(packAuthor)
	byName := map[string][]db.RulesContent{"steel defender": {strangers, owners, packs}}

	if got, _ := monsterNamed(byName, "Steel Defender", packAuthor, owner); got.ID != packs.ID {
		t.Error("a pack's subclass should find the defender its own pack shipped")
	}
	if got, _ := monsterNamed(byName, "Steel Defender", uuid.Nil, owner); got.ID != owners.ID {
		t.Error("an SRD feature naming a homebrew monster finds the owner's first")
	}
	srd := db.RulesContent{ID: uuid.New(), Name: "Steel Defender", Source: db.ContentSourceSrd}
	byName["steel defender"] = append(byName["steel defender"], srd)
	if got, _ := monsterNamed(byName, "steel defender", packAuthor, owner); got.ID != srd.ID {
		t.Error("the book's own entry is never shadowed")
	}
	if _, ok := monsterNamed(byName, "Nothing", packAuthor, owner); ok {
		t.Error("a name nobody holds finds nothing")
	}
}

func TestTheTableHoldsTheNumbers(t *testing.T) {
	campaign := uuid.New()
	seated := db.Character{CampaignID: pgtype.UUID{Bytes: campaign, Valid: true}}
	if !tableLocked(seated, db.Membership{Role: db.MembershipRolePlayer}) {
		t.Error("a player at a table takes creatures as they stand")
	}
	if tableLocked(seated, db.Membership{Role: db.MembershipRoleDm}) {
		t.Error("the DM molds what the player may not")
	}
	if tableLocked(db.Character{}, db.Membership{}) {
		t.Error("an unseated hero is the owner's own sandbox")
	}
}

func TestSameJSON(t *testing.T) {
	if !sameJSON([]byte(`{"a":1,"b":[1,2]}`), []byte(`{"b": [1, 2], "a": 1}`)) {
		t.Error("spacing and key order are not a change")
	}
	if sameJSON([]byte(`{"a":1}`), []byte(`{"a":2}`)) {
		t.Error("a different number is a change")
	}
	if !sameJSON(nil, []byte(`{}`)) {
		t.Error("nothing stored and an empty map say the same")
	}
}
