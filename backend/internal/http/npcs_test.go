package http

import (
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// The pure rules of the people's two veils, without a database: who may know a
// person, and who may read their numbers.

func emptyNpcVeil() *npcVeil {
	return &npcVeil{
		overrides:     map[uuid.UUID]map[uuid.UUID]bool{},
		statOverrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames:     map[uuid.UUID]string{},
	}
}

func emptyPlaces() *veil {
	return &veil{
		locations:      map[uuid.UUID]db.Location{},
		locOverrides:   map[uuid.UUID]map[uuid.UUID]bool{},
		questOverrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames:      map[uuid.UUID]string{},
	}
}

func TestAHiddenPersonIsUnknownAndARevealedOneIsNot(t *testing.T) {
	nv := emptyNpcVeil()
	places := emptyPlaces()
	hero := uuid.New()

	hidden := db.Npc{ID: uuid.New(), VisibleToParty: false}
	shown := db.Npc{ID: uuid.New(), VisibleToParty: true}

	if nv.npcVisibleToAny(hidden, places, []uuid.UUID{hero}) {
		t.Fatal("a veiled person should be unknown to the party")
	}
	if !nv.npcVisibleToAny(shown, places, []uuid.UUID{hero}) {
		t.Fatal("a revealed person should be known to the party")
	}
}

func TestAnOverrideSinglesOutOneHero(t *testing.T) {
	nv := emptyNpcVeil()
	places := emptyPlaces()
	confidant, stranger := uuid.New(), uuid.New()

	n := db.Npc{ID: uuid.New(), VisibleToParty: false}
	nv.overrides[n.ID] = map[uuid.UUID]bool{confidant: true}

	if !nv.npcVisibleTo(n, places, confidant) {
		t.Fatal("the hero singled out should know the person")
	}
	if nv.npcVisibleTo(n, places, stranger) {
		t.Fatal("the rest of the party should not")
	}
	// The union: a viewer whose heroes include the confidant knows them.
	if !nv.npcVisibleToAny(n, places, []uuid.UUID{stranger, confidant}) {
		t.Fatal("knowing through any one hero is knowing")
	}
}

func TestAVeiledPlaceHidesItsPeople(t *testing.T) {
	nv := emptyNpcVeil()
	places := emptyPlaces()
	hero := uuid.New()

	porto := uuid.New()
	places.locations[porto] = db.Location{ID: porto, VisibleToParty: false}

	n := db.Npc{ID: uuid.New(), VisibleToParty: true, LocationID: pgUUID(porto)}
	if nv.npcVisibleToAny(n, places, []uuid.UUID{hero}) {
		t.Fatal("a person filed in a veiled place should be hidden with it")
	}

	places.locations[porto] = db.Location{ID: porto, VisibleToParty: true}
	if !nv.npcVisibleToAny(n, places, []uuid.UUID{hero}) {
		t.Fatal("lifting the place's veil should reveal its people")
	}
}

func TestTheStatsVeilOnlyOpensWhereThePersonIsKnown(t *testing.T) {
	nv := emptyNpcVeil()
	places := emptyPlaces()
	hero := uuid.New()

	// Stats party-visible, person hidden: the numbers stay dark regardless.
	n := db.Npc{ID: uuid.New(), VisibleToParty: false, StatsVisibleToParty: true}
	if nv.statsVisibleToAny(n, places, []uuid.UUID{hero}) {
		t.Fatal("stats must never show for a person the hero does not know")
	}

	n.VisibleToParty = true
	if !nv.statsVisibleToAny(n, places, []uuid.UUID{hero}) {
		t.Fatal("with the person known and the stats revealed, the numbers show")
	}
}

func TestTheTwoVeilsMoveIndependently(t *testing.T) {
	nv := emptyNpcVeil()
	places := emptyPlaces()
	ranger, bard := uuid.New(), uuid.New()

	// The whole party knows the captain; only the ranger sized her up.
	n := db.Npc{ID: uuid.New(), VisibleToParty: true, StatsVisibleToParty: false}
	nv.statOverrides[n.ID] = map[uuid.UUID]bool{ranger: true}

	if !nv.npcVisibleTo(n, places, bard) {
		t.Fatal("the bard should still know the captain")
	}
	if nv.statsVisibleTo(n, places, bard) {
		t.Fatal("the bard should not read her block")
	}
	if !nv.statsVisibleTo(n, places, ranger) {
		t.Fatal("the ranger should read her block")
	}
}

func TestASeatlessViewerFollowsThePartyVeil(t *testing.T) {
	nv := emptyNpcVeil()
	places := emptyPlaces()

	n := db.Npc{ID: uuid.New(), VisibleToParty: true}
	nv.overrides[n.ID] = map[uuid.UUID]bool{uuid.New(): false}

	// No seated heroes: overrides for other heroes do not apply.
	if !nv.npcVisibleToAny(n, places, nil) {
		t.Fatal("a member with no seated hero sees what the party sees")
	}
}
