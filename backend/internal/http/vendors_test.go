package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
What a player is allowed to know about a shop (#102).

The rest of vendors is CRUD the compiler holds up. This is the part that fails
silently: a shop revealed to the party is a deliberate act, and so is every line
on its shelves — a DM shows the swords on the wall and keeps what is under the
counter.

The filtering happens on the way out, never as a flag the client is trusted to
respect, which is what these check. A hidden line is not sent with
`revealed: false` for the UI to hide; it is not sent.
*/

func shop(name string, revealed bool) db.ListVendorsRow {
	return db.ListVendorsRow{ID: uuid.New(), Name: name, Revealed: revealed}
}

func shelf(vendorID uuid.UUID, name string, revealed bool) db.ListStockForCampaignRow {
	return db.ListStockForCampaignRow{
		ID: uuid.New(), VendorID: vendorID, Name: name, Price: "15 gp", Revealed: revealed,
	}
}

func TestAPlayerSeesOnlyTheShelvesTheDMHasShown(t *testing.T) {
	v := shop("Barthen's Provisions", true)
	stock := []db.ListStockForCampaignRow{
		shelf(v.ID, "Rope, Hempen", true),
		shelf(v.ID, "Smokepowder", false), // under the counter
	}

	player := vendorForViewer(v, stock, false, uuid.New())
	if len(player.Stock) != 1 || player.Stock[0].Name != "Rope, Hempen" {
		t.Fatalf("player sees %d lines (%v); want only the revealed one",
			len(player.Stock), namesOf(player.Stock))
	}

	dm := vendorForViewer(v, stock, true, uuid.New())
	if len(dm.Stock) != 2 {
		t.Errorf("DM sees %d lines; want both", len(dm.Stock))
	}
}

// The whole point of the redaction: the hidden line is absent, not present and
// flagged. A client that ignored `revealed` would otherwise print the DM's
// secrets to the party.
func TestAHiddenLineIsAbsentRatherThanFlagged(t *testing.T) {
	v := shop("The Sleeping Giant", true)
	stock := []db.ListStockForCampaignRow{shelf(v.ID, "A Very Cursed Sword", false)}

	player := vendorForViewer(v, stock, false, uuid.New())
	for _, line := range player.Stock {
		if line.Name == "A Very Cursed Sword" {
			t.Fatal("a hidden line reached the player payload at all")
		}
	}
	if len(player.Stock) != 0 {
		t.Errorf("player got %v; want an empty shelf", namesOf(player.Stock))
	}
}

func TestShelvesOfOtherShopsStayOnTheirOwnShelves(t *testing.T) {
	mine, theirs := shop("Mine", true), shop("Theirs", true)
	stock := []db.ListStockForCampaignRow{
		shelf(mine.ID, "My Rope", true),
		shelf(theirs.ID, "Their Rope", true),
	}
	out := vendorForViewer(mine, stock, true, uuid.New())
	if len(out.Stock) != 1 || out.Stock[0].Name != "My Rope" {
		t.Errorf("shop carried %v; want only its own line", namesOf(out.Stock))
	}
}

// A shop with nothing on its shelves is still a shop — an empty list, never a
// null, so the client renders "nothing for sale" rather than crashing on it.
func TestAnEmptyShopCarriesAnEmptyShelf(t *testing.T) {
	out := vendorForViewer(shop("Closed Today", true), nil, true, uuid.New())
	if out.Stock == nil {
		t.Fatal("stock was nil; want an empty list")
	}
	if len(out.Stock) != 0 {
		t.Errorf("stock = %v; want empty", namesOf(out.Stock))
	}
}

func TestQtyCrossesTheTypesWithoutLosingAbsence(t *testing.T) {
	v := shop("General Store", true)
	unlimited := shelf(v.ID, "Rope", true) // qty NULL — as many as you like
	three := shelf(v.ID, "Potion", true)
	n := int32(3)
	three.Qty = &n

	out := vendorForViewer(v, []db.ListStockForCampaignRow{unlimited, three}, true, uuid.New())
	if out.Stock[0].Qty != nil {
		t.Errorf("unlimited stock came back as %d; want no number at all", *out.Stock[0].Qty)
	}
	if out.Stock[1].Qty == nil || *out.Stock[1].Qty != 3 {
		t.Errorf("counted stock = %v; want 3", out.Stock[1].Qty)
	}
}

func namesOf(lines []api.VendorStock) []string {
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		out = append(out, l.Name)
	}
	return out
}

/*
The till's pickers (#174), pure and DB-free like the rest of this file.
*/

func purseRow(id uuid.UUID, name string, qty int32) db.ListCharacterItemsRow {
	return db.ListCharacterItemsRow{ID: id, Name: name, Qty: qty, IsPurse: true}
}

// The purse used to be "the first content-less row named exactly Gold Pieces",
// which a DM renaming their currency would have broken in four places at once
// (#195). It says what it is now — so a shelf line wearing the coin's name is
// no longer a trap, and a renamed purse is still the purse.
func TestThePurseIsTheRowThatSaysItIs(t *testing.T) {
	coin := uuid.New()
	items := []db.ListCharacterItemsRow{
		{ID: uuid.New(), Name: "Gold Pieces", Qty: 5, ContentID: pgUUID(uuid.New())}, // a shelf item
		{ID: uuid.New(), Name: "Gold Pieces", Qty: 7},                                // written-in, not coin
		purseRow(coin, "Glimmer", 4120),                                              // renamed, and the purse
	}
	got := pickPurse(items)
	if got == nil || got.ID != coin {
		t.Fatalf("expected the row flagged as the purse, got %+v", got)
	}
	if pickPurse(nil) != nil {
		t.Error("no rows should mean no purse")
	}
	if pickPurse(items[:2]) != nil {
		t.Error("a hero with no coin row has no purse, whatever their rows are called")
	}
}

func TestAPurchaseStacksOntoTheRightRow(t *testing.T) {
	content := pgUUID(uuid.New())
	purse := uuid.New()
	equipped := db.ListCharacterItemsRow{ID: uuid.New(), ContentID: content, Name: "Longsword", Qty: 1, Equipped: true}
	full := db.ListCharacterItemsRow{ID: uuid.New(), ContentID: content, Name: "Longsword", Qty: 999}
	loose := db.ListCharacterItemsRow{ID: uuid.New(), ContentID: content, Name: "Longsword", Qty: 1}
	items := []db.ListCharacterItemsRow{equipped, full, loose}

	got := pickMergeTarget(items, content, "Longsword", purse)
	if got == nil || got.ID != loose.ID {
		t.Fatalf("expected the loose unequipped stack, got %+v", got)
	}

	// A written-in line matches by exact name among content-less rows only.
	rations := db.ListCharacterItemsRow{ID: uuid.New(), Name: "Rations", Qty: 3}
	if got := pickMergeTarget([]db.ListCharacterItemsRow{rations}, pgtype.UUID{}, "Rations", purse); got == nil || got.ID != rations.ID {
		t.Fatal("a written-in purchase should stack onto its namesake")
	}

	// Never the purse: a shelf line sharing the coin's name must not merge
	// into the coin that just paid for it.
	coin := purseRow(purse, "Gold Pieces", 10)
	if got := pickMergeTarget([]db.ListCharacterItemsRow{coin}, pgtype.UUID{}, "Gold Pieces", purse); got != nil {
		t.Fatalf("the purchase merged into the purse: %+v", got)
	}
}
