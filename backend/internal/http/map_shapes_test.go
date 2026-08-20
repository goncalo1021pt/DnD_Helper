package http

import (
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

func apiPinShape(s string) api.MapPinInputShape { return api.MapPinInputShape(s) }

// Roads and realms under fog (#262). A pin is one point, so it is in or it is
// out; a shape runs across the map, and the honest answer differs by kind.

// seenBefore builds the "is this point uncovered" test out of an x-threshold,
// which is enough to place points on either side of an explored frontier.
func seenBefore(limit float64) func(shapePoint) bool {
	return func(p shapePoint) bool { return p.X <= limit }
}

func run(xs ...float64) []shapePoint {
	pts := make([]shapePoint, 0, len(xs))
	for _, x := range xs {
		pts = append(pts, shapePoint{X: x, Y: 0.5})
	}
	return pts
}

func TestARoadAppearsOnlyAsFarAsItHasBeenWalked(t *testing.T) {
	road := run(0.1, 0.2, 0.3, 0.8, 0.9)
	got := clipShape(db.MapShapeKindLine, road, seenBefore(0.5))

	if len(got) != 1 {
		t.Fatalf("one uncovered stretch should come back as one run, got %d", len(got))
	}
	if len(got[0]) != 3 {
		t.Fatalf("only the walked points belong to the player, got %d", len(got[0]))
	}
	for _, p := range got[0] {
		if p.X > 0.5 {
			t.Fatalf("a point beyond the frontier leaked: %v", p)
		}
	}
}

func TestARoadCrossingDarkGroundComesBackInPieces(t *testing.T) {
	// Walked, then dark, then walked again — the far stretch was reached by
	// another road, and the party still does not know the middle joins them.
	road := []shapePoint{
		{X: 0.1}, {X: 0.2}, // seen
		{X: 0.9},           // dark
		{X: 0.3}, {X: 0.4}, // seen again
	}
	got := clipShape(db.MapShapeKindLine, road, seenBefore(0.5))
	if len(got) != 2 {
		t.Fatalf("two stretches should come back as two runs, got %d", len(got))
	}
}

func TestALoneUncoveredPointIsNotARoad(t *testing.T) {
	// One point cannot be drawn as a line, so a stretch of one is dropped
	// rather than sent as a degenerate shape for the client to puzzle over.
	road := run(0.9, 0.1, 0.9)
	if got := clipShape(db.MapShapeKindLine, road, seenBefore(0.5)); got != nil {
		t.Fatalf("a single uncovered point is no road, got %d runs", len(got))
	}
}

func TestAnEntirelyDarkRoadIsNotSentAtAll(t *testing.T) {
	if got := clipShape(db.MapShapeKindLine, run(0.7, 0.8, 0.9), seenBefore(0.5)); got != nil {
		t.Fatal("a road on ground nobody has walked should be absent, not empty")
	}
}

func TestARegionIsAllOrNothing(t *testing.T) {
	// Dropping points from a polygon does not clip it, it redraws it into a
	// different country — so a region arrives whole or not at all, and the
	// DM-only flag is what holds back one the party should not have the shape
	// of yet.
	kingdom := run(0.1, 0.7, 0.9)
	got := clipShape(db.MapShapeKindArea, kingdom, seenBefore(0.5))
	if len(got) != 1 || len(got[0]) != 3 {
		t.Fatalf("a region touched anywhere comes back whole, got %v", got)
	}

	if got := clipShape(db.MapShapeKindArea, run(0.7, 0.8, 0.9), seenBefore(0.5)); got != nil {
		t.Fatal("a region on wholly dark ground should be absent")
	}
}

func TestTheDMsOwnStrokeIsNeverNarrowedAway(t *testing.T) {
	// clampFloat is what keeps a stroke drawable: thinner than the floor is
	// invisible at any zoom, wider than the ceiling is a wash of colour.
	if got := clampFloat(0.0, minShapeWidth, maxShapeWidth); got != minShapeWidth {
		t.Fatalf("a zero stroke should come up to the floor, got %v", got)
	}
	if got := clampFloat(9.0, minShapeWidth, maxShapeWidth); got != maxShapeWidth {
		t.Fatalf("a runaway stroke should come down to the ceiling, got %v", got)
	}
	if got := clampFloat(0.01, minShapeWidth, maxShapeWidth); got != 0.01 {
		t.Fatalf("a reasonable stroke should be left alone, got %v", got)
	}
}

func TestAMarkerMustBeOneTheMapKnows(t *testing.T) {
	if _, ok := pinShapeOf(nil); !ok {
		t.Fatal("an absent marker is the teardrop every pin was, not a refusal")
	}
	for _, good := range []string{"pin", "circle", "skull"} {
		v := apiPinShape(good)
		if name, ok := pinShapeOf(&v); !ok || name != good {
			t.Fatalf("%q should be a marker the map knows", good)
		}
	}
	bad := apiPinShape("dragon")
	if _, ok := pinShapeOf(&bad); ok {
		t.Fatal("an unknown marker should be refused rather than stored")
	}
}
