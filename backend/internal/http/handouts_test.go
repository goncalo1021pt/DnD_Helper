package http

import (
	"testing"

	"github.com/google/uuid"
)

// prop builds a handout veil holding one prop's per-hero exceptions.
func prop(handoutID uuid.UUID, overrides map[uuid.UUID]bool) *handoutVeil {
	v := &handoutVeil{
		overrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames: map[uuid.UUID]string{},
	}
	if len(overrides) > 0 {
		v.overrides[handoutID] = overrides
	}
	return v
}

func TestVeiledHandoutIsHiddenFromEveryone(t *testing.T) {
	letter, hero := uuid.New(), uuid.New()
	v := prop(letter, nil)

	if v.visibleTo(letter, false, hero) {
		t.Error("a prop the DM has not handed over is nobody's to read")
	}
	if v.visibleToAny(letter, false, []uuid.UUID{hero}) {
		t.Error("no hero of theirs can see it either")
	}
}

func TestPartyRevealReachesEveryHero(t *testing.T) {
	letter, hero, other := uuid.New(), uuid.New(), uuid.New()
	v := prop(letter, nil)

	if !v.visibleTo(letter, true, hero) {
		t.Error("handing it to the party hands it to each hero")
	}
	if !v.visibleToAny(letter, true, []uuid.UUID{other}) {
		t.Error("and to any hero a member has seated")
	}
}

func TestOneHeroReadsWhatThePartyCannot(t *testing.T) {
	letter, rogue, fighter := uuid.New(), uuid.New(), uuid.New()
	v := prop(letter, map[uuid.UUID]bool{rogue: true})

	if !v.visibleTo(letter, false, rogue) {
		t.Error("the hero singled out reads the letter")
	}
	if v.visibleTo(letter, false, fighter) {
		t.Error("the rest of the party still sees nothing")
	}
}

func TestOneHeroIsKeptFromWhatThePartyHas(t *testing.T) {
	letter, cursed, rest := uuid.New(), uuid.New(), uuid.New()
	v := prop(letter, map[uuid.UUID]bool{cursed: false})

	if v.visibleTo(letter, true, cursed) {
		t.Error("an exception hiding a hero beats the party-wide reveal")
	}
	if !v.visibleTo(letter, true, rest) {
		t.Error("everyone else still holds it")
	}
}

// A member watching without a hero at the table — a player between characters,
// or one who has not been seated yet — is judged by the party veil alone.
func TestMemberWithNoSeatedHeroFollowsTheParty(t *testing.T) {
	letter := uuid.New()
	v := prop(letter, map[uuid.UUID]bool{uuid.New(): true})

	if v.visibleToAny(letter, false, nil) {
		t.Error("someone else's exception is not theirs to inherit")
	}
	if !v.visibleToAny(letter, true, nil) {
		t.Error("a party-wide reveal reaches a member with no hero seated")
	}
}

// Any one of a member's heroes seeing the prop is enough — they are the same
// pair of eyes whichever character they are playing tonight.
func TestAnySeatedHeroIsEnough(t *testing.T) {
	letter, blind, sighted := uuid.New(), uuid.New(), uuid.New()
	v := prop(letter, map[uuid.UUID]bool{sighted: true})

	if !v.visibleToAny(letter, false, []uuid.UUID{blind, sighted}) {
		t.Error("one hero holding the letter is enough for their player")
	}
	if v.visibleToAny(letter, false, []uuid.UUID{blind}) {
		t.Error("but only through a hero who actually has it")
	}
}

func TestOverridesForNamesTheHeroesSingledOut(t *testing.T) {
	letter, rogue := uuid.New(), uuid.New()
	v := prop(letter, map[uuid.UUID]bool{rogue: true})
	v.charNames[rogue] = "Vex"

	out := v.overridesFor(letter)
	if len(out) != 1 {
		t.Fatalf("one hero singled out, got %d", len(out))
	}
	if out[0].CharacterName != "Vex" || !out[0].Visible {
		t.Errorf("the DM should read \"Vex, shown\"; got %q, visible=%v",
			out[0].CharacterName, out[0].Visible)
	}
	if got := v.overridesFor(uuid.New()); len(got) != 0 {
		t.Errorf("a prop nobody is singled out on has no exceptions; got %d", len(got))
	}
}
