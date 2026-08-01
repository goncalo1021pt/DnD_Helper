package http

import (
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// The two rules that decide every spend, checked away from the database.
//
// Both used to be loops inside SpendPick, where the only way to reach them was
// to build a campaign, a web, a hero, a pact and a granted pick — so in practice
// nobody reached them, and a wrong answer would have surfaced as a player
// saying "it won't let me take that one" rather than as a failing test.

func minor(id uuid.UUID) db.SkillNode {
	return db.SkillNode{ID: id, Rarity: db.NodeRarityMinor}
}

func keystone(id uuid.UUID) db.SkillNode {
	return db.SkillNode{ID: id, Rarity: db.NodeRarityKeystone}
}

func TestNodeCostChargesTheTreesPriceForKeystones(t *testing.T) {
	// The price is the tree's, not a constant: two webs in the same campaign may
	// value their keystones differently.
	if got := nodeCost(db.NodeRarityKeystone, 3); got != 3 {
		t.Errorf("keystone in a 3-pick tree cost %d; want 3", got)
	}
	if got := nodeCost(db.NodeRarityKeystone, 1); got != 1 {
		t.Errorf("keystone in a 1-pick tree cost %d; want 1", got)
	}
	// Anything that is not a keystone is one pick, whatever the tree charges.
	if got := nodeCost(db.NodeRarityMinor, 5); got != 1 {
		t.Errorf("minor power cost %d in a 5-pick tree; want 1 — the keystone price must not leak", got)
	}
}

func TestPicksSpentTotalsTheWholeWeb(t *testing.T) {
	if got := picksSpent(nil, 3); got != 0 {
		t.Errorf("an unspent hero has spent %d; want 0", got)
	}

	taken := []db.SkillNode{
		minor(uuid.New()),
		minor(uuid.New()),
		keystone(uuid.New()),
	}
	if got := picksSpent(taken, 3); got != 5 { // 1 + 1 + 3
		t.Errorf("picksSpent = %d; want 5 (two minors and a 3-pick keystone)", got)
	}
	// The same web under a cheaper tree costs less — the price is read from the
	// tree every time rather than remembered from when the pick was made.
	if got := picksSpent(taken, 1); got != 3 {
		t.Errorf("picksSpent = %d; want 3 when the tree charges 1 for a keystone", got)
	}
}

// The regression this exists for: edges are stored one way round only, so a
// claimed power can sit on either end of the row. Checking a single end would
// strand about half of every web, and which half would come down to nothing but
// the uuids the nodes were handed.
func TestWithinReachFollowsAnEdgeFromEitherEnd(t *testing.T) {
	claimed, wantedA, wantedB := uuid.New(), uuid.New(), uuid.New()
	taken := map[uuid.UUID]bool{claimed: true}

	edges := []db.SkillEdge{
		{NodeA: claimed, NodeB: wantedA}, // claimed power on the A side
		{NodeA: wantedB, NodeB: claimed}, // and on the B side
	}

	if !withinReach(wantedA, edges, taken) {
		t.Error("a power hanging off the A end of a claimed power is in reach")
	}
	if !withinReach(wantedB, edges, taken) {
		t.Error("a power hanging off the B end of a claimed power is in reach too — the web is undirected")
	}
}

func TestAPowerWithNoClaimedNeighbourIsOutOfReach(t *testing.T) {
	claimed, near, far := uuid.New(), uuid.New(), uuid.New()
	taken := map[uuid.UUID]bool{claimed: true}

	// A chain: claimed — near — far. Only the next step along is in reach.
	edges := []db.SkillEdge{
		{NodeA: claimed, NodeB: near},
		{NodeA: near, NodeB: far},
	}

	if !withinReach(near, edges, taken) {
		t.Error("the next power along the chain should be in reach")
	}
	if withinReach(far, edges, taken) {
		t.Error("a power two steps out must NOT be in reach — the hero has to walk there")
	}
}

func TestAnEdgeBetweenTwoUnclaimedPowersLeadsNowhere(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	edges := []db.SkillEdge{{NodeA: a, NodeB: b}}

	// A drawn web with nothing claimed in it yet. Every non-entry power in it is
	// out of reach, or the first pick could land anywhere on the tree.
	if withinReach(a, edges, map[uuid.UUID]bool{}) || withinReach(b, edges, map[uuid.UUID]bool{}) {
		t.Error("an edge between two unclaimed powers must not make either reachable")
	}
	// And a web with no edges at all leads nowhere by the same rule.
	if withinReach(a, nil, map[uuid.UUID]bool{b: true}) {
		t.Error("with no edges drawn, nothing is adjacent to anything")
	}
}
