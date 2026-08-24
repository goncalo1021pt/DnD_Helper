package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

/*
The two gates in front of a map (#276): its own veil, and the place it depicts.

newVeil / locSpec come from visibility_test.go — the place tree is the same
tree, which is the point of borrowing the walk rather than inventing a second
one.
*/

// chart builds a map row, optionally filed under a place.
func chart(id, locID uuid.UUID, visible bool) mapRow {
	m := mapRow{ID: id, VisibleToParty: visible}
	if locID != uuid.Nil {
		m.LocationID = pgtype.UUID{Bytes: locID, Valid: true}
	}
	return m
}

// atlas builds a map veil holding one chart's per-hero exceptions.
func atlas(mapID uuid.UUID, overrides map[uuid.UUID]bool) *mapVeil {
	v := &mapVeil{
		overrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames: map[uuid.UUID]string{},
	}
	if len(overrides) > 0 {
		v.overrides[mapID] = overrides
	}
	return v
}

func TestAMapNobodyWasShownIsNobodys(t *testing.T) {
	lair, hero := uuid.New(), uuid.New()
	v := atlas(lair, nil)
	places := newVeil(nil)

	if v.visibleTo(chart(lair, uuid.Nil, false), places, hero) {
		t.Error("a map the DM has not hung in the hall is nobody's to know of")
	}
	if v.visibleToAny(chart(lair, uuid.Nil, false), places, []uuid.UUID{hero}) {
		t.Error("and no hero of theirs finds it either")
	}
	// A member with no hero seated is judged by the party-wide flag alone.
	if v.visibleToAny(chart(lair, uuid.Nil, false), places, nil) {
		t.Error("a member watching without a hero sees what the party sees")
	}
	if !v.visibleToAny(chart(lair, uuid.Nil, true), places, nil) {
		t.Error("...which includes a map the whole table has")
	}
}

func TestOneScoutHoldsTheMapTheTableCannot(t *testing.T) {
	road, scout, rest := uuid.New(), uuid.New(), uuid.New()
	v := atlas(road, map[uuid.UUID]bool{scout: true})
	places := newVeil(nil)
	m := chart(road, uuid.Nil, false)

	if !v.visibleTo(m, places, scout) {
		t.Error("the hero who rode ahead has the map")
	}
	if v.visibleTo(m, places, rest) {
		t.Error("the rest of the party still has nothing")
	}
}

func TestOneHeroIsKeptFromTheMapTheTableHas(t *testing.T) {
	world, lost, rest := uuid.New(), uuid.New(), uuid.New()
	v := atlas(world, map[uuid.UUID]bool{lost: false})
	places := newVeil(nil)
	m := chart(world, uuid.Nil, true)

	if v.visibleTo(m, places, lost) {
		t.Error("a hero singled out is kept from it")
	}
	if !v.visibleTo(m, places, rest) {
		t.Error("while the party keeps what it was given")
	}
}

// Veiling a city veils its city map, without the DM touching the map at all.
func TestAMapFollowsThePlaceItDepicts(t *testing.T) {
	barovia, village := uuid.New(), uuid.New()
	places := newVeil(map[uuid.UUID]locSpec{
		barovia: {visible: false},
		village: {parent: barovia, visible: true},
	})
	cityMap, streetMap := uuid.New(), uuid.New()
	v := atlas(cityMap, nil)
	hero := uuid.New()

	if v.visibleTo(chart(cityMap, barovia, true), places, hero) {
		t.Error("a map of a place nobody knows of is a map of nothing")
	}
	// The ancestor walk has the final word, exactly as it does for a notice
	// or one of the Folk: an unveiled village inside a veiled country is
	// still inside a veiled country.
	if v.visibleTo(chart(streetMap, village, true), places, hero) {
		t.Error("hiding Barovia hides everything hanging in Barovia")
	}
}

// A map filed nowhere is judged on its own veil alone — most maps are.
func TestAMapOfNoPlaceStandsOnItsOwn(t *testing.T) {
	sketch := uuid.New()
	places := newVeil(nil)
	v := atlas(sketch, nil)

	if !v.visibleTo(chart(sketch, uuid.Nil, true), places, uuid.New()) {
		t.Error("a map depicting no place answers to nothing but its own veil")
	}
}

// A hero singled out cannot see through the place tree: the second gate is
// not a way around the first, in either direction.
func TestSinglingOutOneHeroDoesNotOpenAVeiledPlace(t *testing.T) {
	underdark := uuid.New()
	places := newVeil(map[uuid.UUID]locSpec{underdark: {visible: false}})
	deepMap, scout := uuid.New(), uuid.New()
	v := atlas(deepMap, map[uuid.UUID]bool{scout: true})

	if v.visibleTo(chart(deepMap, underdark, false), places, scout) {
		t.Error("handing one hero the map does not hand them the country")
	}
}

func TestMapOverridesForNamesTheHeroesSingledOut(t *testing.T) {
	lair, scout := uuid.New(), uuid.New()
	v := atlas(lair, map[uuid.UUID]bool{scout: true})
	v.charNames[scout] = "Vasco"

	got := v.overridesFor(lair)
	if len(got) != 1 || got[0].CharacterId != scout || got[0].CharacterName != "Vasco" || !got[0].Visible {
		t.Errorf("the DM's list should name the hero singled out, got %+v", got)
	}
	if got := v.overridesFor(uuid.New()); len(got) != 0 {
		t.Errorf("a map nobody is singled out on has an empty list, got %+v", got)
	}
}
