package http

import (
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
)

/*
The world reads as a tree (#196).

The page indents each place by its depth, so the ORDER is what says whose
child a row is. Sorting by depth and then by name banded the list instead —
every kingdom in the world together, alphabetically across unrelated
continents — and two kingdoms with different parents rendered as adjacent,
equally indented rows under whichever continent happened to sort last.
*/

func place(name string, id uuid.UUID, parent *uuid.UUID, depth int) api.Location {
	return api.Location{Id: id, Name: name, ParentId: parent, Depth: depth}
}

func names(places []api.Location) []string {
	out := make([]string, 0, len(places))
	for _, l := range places {
		out = append(out, l.Name)
	}
	return out
}

func equal(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// The issue's own world: two kingdoms under different continents.
func TestTreeOrderKeepsChildrenWithTheirParent(t *testing.T) {
	world := uuid.New()
	milis, human, demon := uuid.New(), uuid.New(), uuid.New()
	asura, holy := uuid.New(), uuid.New()

	// Deliberately shuffled: the answer must not depend on the input order.
	in := []api.Location{
		place("Asura Kingdom", asura, &human, 2),
		place("Milis Continent", milis, &world, 1),
		place("6 Faced World", world, nil, 0),
		place("Holy Milis Empire", holy, &milis, 2),
		place("Human Continent", human, &world, 1),
		place("Demon Continent", demon, &world, 1),
	}

	want := []string{
		"6 Faced World",
		"Demon Continent",
		"Human Continent",
		"Asura Kingdom",     // inside Human, and said so by sitting under it
		"Milis Continent",
		"Holy Milis Empire", // inside Milis
	}
	if got := names(treeOrder(in)); !equal(got, want) {
		t.Errorf("tree order = %v\nwant %v", got, want)
	}
}

// A player is shown a revealed place while an ancestor above it stays veiled,
// so its parent is simply absent from their slice. It is a root to them —
// dropping it would hide a place the server just decided they may see.
func TestTreeOrderKeepsPlacesWhoseParentIsHidden(t *testing.T) {
	missing := uuid.New()
	orphan, root := uuid.New(), uuid.New()
	in := []api.Location{
		place("Sunken Vault", orphan, &missing, 2),
		place("Waterdeep", root, nil, 0),
	}
	got := names(treeOrder(in))
	if len(got) != 2 {
		t.Fatalf("a place whose parent is veiled must survive; got %v", got)
	}
	if !equal(got, []string{"Sunken Vault", "Waterdeep"}) {
		t.Errorf("orphans sort among the roots by name; got %v", got)
	}
}

// The depth cap is enforced on write, but the walk must not hang if a loop
// ever reaches it — and every place still has to come back.
func TestTreeOrderSurvivesACycle(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	in := []api.Location{
		place("A", a, &b, 1),
		place("B", b, &a, 1),
		place("Solid Ground", uuid.New(), nil, 0),
	}
	got := treeOrder(in)
	if len(got) != len(in) {
		t.Fatalf("every place must come back; got %v", names(got))
	}
}

func TestTreeOrderIsStableAndComplete(t *testing.T) {
	root := uuid.New()
	kids := make([]api.Location, 0, 3)
	in := []api.Location{place("Root", root, nil, 0)}
	for _, n := range []string{"Zeta", "Alpha", "Mu"} {
		k := place(n, uuid.New(), &root, 1)
		kids = append(kids, k)
		in = append(in, k)
	}
	want := []string{"Root", "Alpha", "Mu", "Zeta"}
	if got := names(treeOrder(in)); !equal(got, want) {
		t.Errorf("siblings should be alphabetical; got %v want %v", got, want)
	}
}
