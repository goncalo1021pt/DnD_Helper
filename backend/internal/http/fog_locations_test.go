package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// circle builds one candidate row: the pool query has already admitted it, so
// what is left to decide is the place it hangs in (uuid.Nil for none).
func circle(x, y float64, locID uuid.UUID) db.ListVisibleRevealCirclesRow {
	row := db.ListVisibleRevealCirclesRow{X: x, Y: y, R: 0.1}
	if locID != uuid.Nil {
		row.LocationID = pgtype.UUID{Bytes: locID, Valid: true}
	}
	return row
}

func centers(circles []circleGeom) []float64 {
	out := make([]float64, 0, len(circles))
	for _, c := range circles {
		out = append(out, c.X)
	}
	return out
}

// The issue's own case: a hero who grew up in Lisboa knows the city before the
// party ever rides in, and nobody else's fog moves.
func TestFogFollowsThePlaceVeil(t *testing.T) {
	portugal, lisboa := uuid.New(), uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{
		portugal: {visible: true},
		lisboa:   {parent: portugal, visible: false},
	})
	local, stranger := uuid.New(), uuid.New()
	v.locOverrides[lisboa] = map[uuid.UUID]bool{local: true}

	rows := []db.ListVisibleRevealCirclesRow{
		circle(0.1, 0.1, uuid.Nil), // the road east — everyone has it
		circle(0.5, 0.5, lisboa),   // the city itself
	}

	got := filterRevealCircles(rows, v, []uuid.UUID{local})
	if len(got) != 2 {
		t.Fatalf("the hero from Lisboa should see both circles, got %v", centers(got))
	}

	got = filterRevealCircles(rows, v, []uuid.UUID{stranger})
	if len(got) != 1 || got[0].X != 0.1 {
		t.Fatalf("a stranger to Lisboa should see only the unplaced circle, got %v", centers(got))
	}
}

// A batch in no place is the pre-#191 behaviour and must stay untouched: the
// pool decided, and nothing here may take it back.
func TestFogWithoutAPlaceIsUngated(t *testing.T) {
	rows := []db.ListVisibleRevealCirclesRow{circle(0.2, 0.2, uuid.Nil)}
	if got := filterRevealCircles(rows, nil, nil); len(got) != 1 {
		t.Fatalf("an unplaced circle should survive with no veil loaded, got %v", centers(got))
	}
}

// Hiding a country hides the cities in it — on the map exactly as on the board.
func TestFogHidesWhenAnAncestorIsVeiled(t *testing.T) {
	portugal, lisboa := uuid.New(), uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{
		portugal: {visible: false},
		lisboa:   {parent: portugal, visible: true},
	})
	hero := uuid.New()
	v.locOverrides[lisboa] = map[uuid.UUID]bool{hero: true}

	rows := []db.ListVisibleRevealCirclesRow{circle(0.5, 0.5, lisboa)}
	if got := filterRevealCircles(rows, v, []uuid.UUID{hero}); len(got) != 0 {
		t.Fatalf("a revealed city inside a veiled country stays fogged, got %v", centers(got))
	}
}

// Two heroes at one seat: knowledge is the union of what the player's heroes
// have, which is how the rest of the veil already answers.
func TestFogTakesTheUnionOfAViewersHeroes(t *testing.T) {
	lisboa := uuid.New()
	v := newVeil(map[uuid.UUID]locSpec{lisboa: {visible: false}})
	native, newcomer := uuid.New(), uuid.New()
	v.locOverrides[lisboa] = map[uuid.UUID]bool{native: true}

	rows := []db.ListVisibleRevealCirclesRow{circle(0.5, 0.5, lisboa)}
	if got := filterRevealCircles(rows, v, []uuid.UUID{newcomer, native}); len(got) != 1 {
		t.Fatalf("one hero knowing Lisboa is enough for their player, got %v", centers(got))
	}
}

// A member watching with no hero seated is judged by the party veil alone.
func TestFogForASeatlessViewerFollowsTheParty(t *testing.T) {
	lisboa := uuid.New()
	rows := []db.ListVisibleRevealCirclesRow{circle(0.5, 0.5, lisboa)}

	veiled := newVeil(map[uuid.UUID]locSpec{lisboa: {visible: false}})
	if got := filterRevealCircles(rows, veiled, nil); len(got) != 0 {
		t.Fatalf("a drafted place stays fogged for a seatless viewer, got %v", centers(got))
	}

	shown := newVeil(map[uuid.UUID]locSpec{lisboa: {visible: true}})
	if got := filterRevealCircles(rows, shown, nil); len(got) != 1 {
		t.Fatalf("a party-revealed place lifts for a seatless viewer, got %v", centers(got))
	}
}

// A batch pointing at a place that is gone (a read racing a delete) fogs over.
// The cascade should have taken the batch with it; if one is ever seen, the
// answer is still fog rather than a circle nobody can account for.
func TestFogHidesABatchWhosePlaceVanished(t *testing.T) {
	v := newVeil(map[uuid.UUID]locSpec{})
	rows := []db.ListVisibleRevealCirclesRow{circle(0.5, 0.5, uuid.New())}
	if got := filterRevealCircles(rows, v, []uuid.UUID{uuid.New()}); len(got) != 0 {
		t.Fatalf("a batch whose place is missing must not leak, got %v", centers(got))
	}
}

// The image cache holds one render per distinct reveal set, so two players with
// different ground do not evict each other on every request.
func TestFogImageCacheKeepsAVariantPerPlayer(t *testing.T) {
	c := newFogImageCache()
	mapID := uuid.New()
	c.put(mapID, fogCacheEntry{version: "party", body: []byte("a")})
	c.put(mapID, fogCacheEntry{version: "local", body: []byte("b")})

	for _, v := range []string{"party", "local"} {
		if _, ok := c.get(mapID, v); !ok {
			t.Fatalf("render %q should still be cached", v)
		}
	}

	// Past the cap, the oldest goes and the newest stays.
	for i := 0; i < fogCacheVariants; i++ {
		c.put(mapID, fogCacheEntry{version: string(rune('a' + i))})
	}
	if _, ok := c.get(mapID, "party"); ok {
		t.Error("the oldest variant should have been dropped once the map filled up")
	}
	if _, ok := c.get(mapID, string(rune('a'+fogCacheVariants-1))); !ok {
		t.Error("the newest variant should be cached")
	}
	if n := len(c.entries[mapID]); n > fogCacheVariants {
		t.Errorf("cache held %d variants, cap is %d", n, fogCacheVariants)
	}
}
