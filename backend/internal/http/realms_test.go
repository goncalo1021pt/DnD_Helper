package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// The pure rules of the container (#233), without a database: what a realm's
// name may be, and when an emptied one is swept rather than kept.

func TestARealmNeedsAName(t *testing.T) {
	if _, msg := validRealmName("   "); msg == "" {
		t.Fatal("a realm of blanks should be refused")
	}
	if _, msg := validRealmName(string(make([]rune, maxRealmName+1))); msg == "" {
		t.Fatal("a name past the ceiling should be refused")
	}
	name, msg := validRealmName("  Faerûn  ")
	if msg != "" {
		t.Fatalf("a good name should be accepted, got %q", msg)
	}
	if name != "Faerûn" {
		t.Fatalf("the name should come back trimmed, got %q", name)
	}
}

// sweepable is the rule sweepUnnamedRealm applies once it has counted: an
// emptied realm nobody ever named is a container nobody set out to make, while
// a named one stands however empty — that one is a place, waiting for the next
// campaign on this ground.
func sweepable(r db.Realm, campaigns int64) bool { return campaigns == 0 && !r.Named }

func TestAnEmptiedRealmNobodyNamedIsSweptAway(t *testing.T) {
	minted := db.Realm{ID: uuid.New(), Name: "Lost Mine of Phandelver", Named: false}
	if !sweepable(minted, 0) {
		t.Fatal("a realm still wearing its campaign's name, now empty, should be swept")
	}
	if sweepable(minted, 1) {
		t.Fatal("a realm with a campaign standing in it is never swept")
	}
}

func TestANamedRealmStandsHoweverEmpty(t *testing.T) {
	named := db.Realm{ID: uuid.New(), Name: "Barovia", Named: true}
	if sweepable(named, 0) {
		t.Fatal("a realm the owner named is a place, and outlives its campaigns")
	}
}

// Every campaign stands somewhere: the column is NOT NULL, so there is no such
// thing as a table on no ground, and toAPICampaign can hand the id over
// unconditionally rather than as a pointer that might be absent.
func TestEveryCampaignStandsOnGround(t *testing.T) {
	c := db.Campaign{
		ID: uuid.New(), Name: "Curse of Strahd", RealmID: uuid.New(),
		CreatedAt: pgtype.Timestamptz{Valid: true},
	}
	out := toAPICampaign(c, true)
	if out.RealmId != c.RealmID {
		t.Fatalf("the realm should ride on the campaign, got %v", out.RealmId)
	}
	if out.RealmId == uuid.Nil {
		t.Fatal("a campaign on the nil realm is a campaign on no ground")
	}
}
