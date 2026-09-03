package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// buildVeil wires a small place tree by hand. Locations are given as
// name -> (parent, visibleToParty).
type locSpec struct {
	parent  uuid.UUID
	visible bool
}

func newVeil(locs map[uuid.UUID]locSpec) *veil {
	v := &veil{
		locations:      map[uuid.UUID]db.ListLocationsByCampaignRow{},
		locOverrides:   map[uuid.UUID]map[uuid.UUID]bool{},
		questOverrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames:      map[uuid.UUID]string{},
	}
	for id, spec := range locs {
		l := db.ListLocationsByCampaignRow{ID: id, VisibleToParty: spec.visible}
		if spec.parent != uuid.Nil {
			l.ParentID = pgtype.UUID{Bytes: spec.parent, Valid: true}
		}
		v.locations[id] = l
	}
	return v
}

func quest(id, locID uuid.UUID, visible bool) db.Quest {
	q := db.Quest{ID: id, VisibleToParty: visible}
	if locID != uuid.Nil {
		q.LocationID = pgtype.UUID{Bytes: locID, Valid: true}
	}
	return q
}

// The issue's own example: Portugal holds Lisboa, Porto and Braga; the party
// has only been shown Lisboa, and only some of its notices.
func TestQuestVisibilityFollowsTheLocationChain(t *testing.T) {
	portugal, lisboa, porto := uuid.New(), uuid.New(), uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{
		portugal: {visible: true},
		lisboa:   {parent: portugal, visible: true},
		porto:    {parent: portugal, visible: false},
	})

	hero := uuid.New()
	shown := quest(uuid.New(), lisboa, true)
	drafted := quest(uuid.New(), lisboa, false)
	inPorto := quest(uuid.New(), porto, true)

	if !v.questVisibleTo(shown, hero) {
		t.Error("a posted notice in a revealed city should be on the board")
	}
	if v.questVisibleTo(drafted, hero) {
		t.Error("a drafted notice should stay off the board")
	}
	if v.questVisibleTo(inPorto, hero) {
		t.Error("a posted notice in a veiled city should stay hidden")
	}
}

// Veiling the region hides every city under it, however those cities are set.
func TestVeilingAnAncestorHidesTheSubtree(t *testing.T) {
	portugal, lisboa, alfama := uuid.New(), uuid.New(), uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{
		portugal: {visible: false},
		lisboa:   {parent: portugal, visible: true},
		alfama:   {parent: lisboa, visible: true},
	})

	hero := uuid.New()
	if v.locationVisibleTo(lisboa, hero) || v.locationVisibleTo(alfama, hero) {
		t.Error("hiding the region should hide the cities and districts inside it")
	}
}

func TestPerHeroOverridesBeatThePartyVeil(t *testing.T) {
	lisboa := uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{lisboa: {visible: false}})

	rogue, cleric := uuid.New(), uuid.New()
	secret := quest(uuid.New(), uuid.Nil, false)

	// The rogue alone is let in on a drafted notice.
	v.questOverrides[secret.ID] = map[uuid.UUID]bool{rogue: true}
	if !v.questVisibleTo(secret, rogue) {
		t.Error("a hero revealed to should see the notice")
	}
	if v.questVisibleTo(secret, cleric) {
		t.Error("the rest of the party should still be in the dark")
	}

	// And the reverse: one hero is shut out of something everyone else sees.
	open := quest(uuid.New(), uuid.Nil, true)
	v.questOverrides[open.ID] = map[uuid.UUID]bool{cleric: false}
	if v.questVisibleTo(open, cleric) {
		t.Error("a hero hidden from should not see the notice")
	}
	if !v.questVisibleTo(open, rogue) {
		t.Error("hiding from one hero should not hide it from the others")
	}
}

// A hero let in on a city still needs the region above it to be open — an
// override lifts one veil, not every veil.
func TestOverrideOnAChildDoesNotPierceAVeiledParent(t *testing.T) {
	portugal, lisboa := uuid.New(), uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{
		portugal: {visible: false},
		lisboa:   {parent: portugal, visible: false},
	})
	hero := uuid.New()
	v.locOverrides[lisboa] = map[uuid.UUID]bool{hero: true}

	if v.locationVisibleTo(lisboa, hero) {
		t.Error("revealing a city should not reveal it through a veiled region")
	}

	// Opening the region too lets the hero in, and nobody else.
	v.locOverrides[portugal] = map[uuid.UUID]bool{hero: true}
	if !v.locationVisibleTo(lisboa, hero) {
		t.Error("with both veils lifted for this hero, the city should show")
	}
	if v.locationVisibleTo(lisboa, uuid.New()) {
		t.Error("another hero should still see nothing")
	}
}

// A member watching without a seated hero sees exactly what the party sees.
func TestMemberWithNoHeroSeesThePartyView(t *testing.T) {
	lisboa := uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{lisboa: {visible: true}})

	open := quest(uuid.New(), lisboa, true)
	drafted := quest(uuid.New(), lisboa, false)

	if !v.questVisibleToAny(open, nil) {
		t.Error("a party-wide notice should show to a member with no hero")
	}
	if v.questVisibleToAny(drafted, nil) {
		t.Error("a drafted notice should not show to a member with no hero")
	}

	// An override naming a hero must not leak to the heroless view.
	v.questOverrides[drafted.ID] = map[uuid.UUID]bool{uuid.New(): true}
	if v.questVisibleToAny(drafted, nil) {
		t.Error("another hero's override should not apply to the party view")
	}
}

// A player with several heroes seated sees the union of their boards.
func TestVisibilityIsTheUnionAcrossAPlayersHeroes(t *testing.T) {
	v := newVeil(nil)
	first, second := uuid.New(), uuid.New()
	q := quest(uuid.New(), uuid.Nil, false)
	v.questOverrides[q.ID] = map[uuid.UUID]bool{second: true}

	if !v.questVisibleToAny(q, []uuid.UUID{first, second}) {
		t.Error("a notice shown to one of the player's heroes should reach them")
	}
	if v.questVisibleToAny(q, []uuid.UUID{first}) {
		t.Error("their other hero alone should not see it")
	}
}

func TestDepthAndHeightDescribeTheTree(t *testing.T) {
	portugal, lisboa, alfama := uuid.New(), uuid.New(), uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{
		portugal: {visible: true},
		lisboa:   {parent: portugal, visible: true},
		alfama:   {parent: lisboa, visible: true},
	})

	for loc, want := range map[uuid.UUID]int{portugal: 0, lisboa: 1, alfama: 2} {
		if got, ok := v.depthOf(loc); !ok || got != want {
			t.Errorf("depth = %d (ok=%v), want %d", got, ok, want)
		}
	}
	if got := v.heightBelow(portugal); got != 2 {
		t.Errorf("height below the region = %d, want 2", got)
	}
	if got := v.heightBelow(alfama); got != 0 {
		t.Errorf("height below a leaf = %d, want 0", got)
	}
	if !v.isDescendant(alfama, portugal) {
		t.Error("a district should count as inside its region")
	}
	if v.isDescendant(portugal, alfama) {
		t.Error("a region should not count as inside its own district")
	}
}

// A cycle can only arrive through a corrupt row, but it must not hang the
// request that reads it.
func TestCyclesResolveToHiddenRatherThanLooping(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{
		a: {parent: b, visible: true},
		b: {parent: a, visible: true},
	})

	if v.locationVisibleTo(a, uuid.New()) {
		t.Error("a looping chain should resolve hidden, not visible")
	}
	if _, ok := v.depthOf(a); ok {
		t.Error("a looping chain should report no usable depth")
	}
}

func TestMissingLocationResolvesHidden(t *testing.T) {
	v := newVeil(nil)
	q := quest(uuid.New(), uuid.New(), true)
	if v.questVisibleTo(q, uuid.New()) {
		t.Error("a notice pinned to a place that no longer exists should stay hidden")
	}
}
