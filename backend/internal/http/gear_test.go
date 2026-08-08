package http

import (
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
What every item may carry (#101).

Gear held only the fields that mattered in a fight — an AC, a damage die — so
there was nowhere to put what a thing costs, what it weighs, or whether it is
magical at all. These are the rules for the fields that were added, and they
are deliberately permissive: blank is fine everywhere, because most gear has no
rarity and plenty of homebrew has no price, and a form that refuses an item for
lacking a field it does not need stops being used.
*/

func trappings(pairs map[string]interface{}) map[string]interface{} { return pairs }

func TestAnItemNeedNotSayAnythingAboutItself(t *testing.T) {
	if msg := validateItemTrappings(trappings(map[string]interface{}{})); msg != "" {
		t.Errorf("a plain item was refused: %s", msg)
	}
	if msg := validateItemTrappings(trappings(map[string]interface{}{
		"rarity": "", "cost": "  ",
	})); msg != "" {
		t.Errorf("blank fields were refused: %s", msg)
	}
}

func TestRarityIsTheOneTheBooksUse(t *testing.T) {
	for _, r := range []string{"common", "uncommon", "rare", "very rare", "legendary", "artifact"} {
		if msg := validateItemTrappings(map[string]interface{}{"rarity": r}); msg != "" {
			t.Errorf("rarity %q was refused: %s", r, msg)
		}
	}
	// Case and spacing are the author's business, not the rule's.
	if msg := validateItemTrappings(map[string]interface{}{"rarity": " Very Rare "}); msg != "" {
		t.Errorf("a differently-cased rarity was refused: %s", msg)
	}
	if msg := validateItemTrappings(map[string]interface{}{"rarity": "mythic"}); msg == "" {
		t.Error("an invented rarity was accepted — the sheet has no colour for it")
	}
}

func TestCostReadsLikeAPrice(t *testing.T) {
	for _, c := range []string{"15 gp", "1 sp", "5,000 gp", "2cp", "10 pp", "0.5 gp"} {
		if msg := validateItemTrappings(map[string]interface{}{"cost": c}); msg != "" {
			t.Errorf("cost %q was refused: %s", c, msg)
		}
	}
	// Prose here becomes a number the sheet prints, so it is refused rather
	// than shown as-is.
	for _, c := range []string{"priceless", "15", "gp", "15 gold", "about 20 gp"} {
		if msg := validateItemTrappings(map[string]interface{}{"cost": c}); msg == "" {
			t.Errorf("cost %q was accepted; it is not a price", c)
		}
	}
}

func TestWeightIsAWeight(t *testing.T) {
	if msg := validateItemTrappings(map[string]interface{}{"weight": float64(0)}); msg != "" {
		t.Errorf("a weightless item was refused: %s", msg)
	}
	if msg := validateItemTrappings(map[string]interface{}{"weight": float64(65)}); msg != "" {
		t.Errorf("plate armour was refused: %s", msg)
	}
	if msg := validateItemTrappings(map[string]interface{}{"weight": float64(-1)}); msg == "" {
		t.Error("a negative weight was accepted")
	}
}

/*
The one rule with an opinion. Attunement is a property of magic items, so an
attuned mundane rope is not a thing the rules allow — and on the sheet it reads
as a magic item that forgot to say what kind, which is worse than being refused.
*/
func TestOnlyAMagicItemCanAskToBeAttunedTo(t *testing.T) {
	if msg := validateItemTrappings(map[string]interface{}{"attunement": true}); msg == "" {
		t.Error("a mundane item was allowed to require attunement")
	}
	if msg := validateItemTrappings(map[string]interface{}{
		"attunement": true, "rarity": "rare",
	}); msg != "" {
		t.Errorf("a rare item requiring attunement was refused: %s", msg)
	}
	// Not attuning is always fine, magical or not.
	if msg := validateItemTrappings(map[string]interface{}{"attunement": false}); msg != "" {
		t.Errorf("an unattuned mundane item was refused: %s", msg)
	}
}

/*
The magic on an item (#189): where it is worn, and what its +N is worth.
*/

func TestWearBelongsOnGearAndNamesARealPlace(t *testing.T) {
	if msg := validateMagicItem(map[string]interface{}{"type": "gear", "wear": "cloak"}); msg != "" {
		t.Errorf("a cloak was refused: %s", msg)
	}
	if msg := validateMagicItem(map[string]interface{}{"type": "armor", "wear": "cloak"}); msg == "" {
		t.Error("armor was allowed to declare a wear kind — it has its own slot")
	}
	if msg := validateMagicItem(map[string]interface{}{"type": "gear", "wear": "hatband"}); msg == "" {
		t.Error("an invented wear kind was accepted — the rig has no slot for it")
	}
}

func TestAMagicBonusIsSmallAndHasSomewhereToLand(t *testing.T) {
	ok := map[string]interface{}{"type": "weapon", "bonus": float64(1), "rarity": "uncommon"}
	if msg := validateMagicItem(ok); msg != "" {
		t.Errorf("a +1 weapon was refused: %s", msg)
	}
	worn := map[string]interface{}{"type": "gear", "wear": "ring", "bonus": float64(1), "rarity": "rare"}
	if msg := validateMagicItem(worn); msg != "" {
		t.Errorf("a ring of protection was refused: %s", msg)
	}
	for _, bad := range []interface{}{float64(0), float64(4), float64(1.5), "one"} {
		if msg := validateMagicItem(map[string]interface{}{"type": "weapon", "bonus": bad, "rarity": "rare"}); msg == "" {
			t.Errorf("bonus %v was accepted", bad)
		}
	}
	if msg := validateMagicItem(map[string]interface{}{"type": "gear", "bonus": float64(1), "rarity": "rare"}); msg == "" {
		t.Error("a bonus on unworn gear was accepted — it has nowhere to apply")
	}
	if msg := validateMagicItem(map[string]interface{}{"type": "weapon", "bonus": float64(1)}); msg == "" {
		t.Error("a bonus without a rarity was accepted — only magic carries one")
	}
}

/*
Attunement (#189), as a pure decision: only an item that asks for the bond can
take it, and three bonds are the most a hero can hold. Kept free of the
database so the rule is testable the way the rest of this file is.
*/

func TestOnlyAnAttunementItemTakesTheBond(t *testing.T) {
	if msg := attuneRefusal(false, itemData{}, 0); msg == "" {
		t.Error("a free-text row was allowed to attune")
	}
	if msg := attuneRefusal(true, itemData{Type: "weapon"}, 0); msg == "" {
		t.Error("a mundane library item was allowed to attune")
	}
	if msg := attuneRefusal(true, itemData{Type: "weapon", Attunement: true}, 0); msg != "" {
		t.Errorf("an attunement weapon was refused: %s", msg)
	}
}

func TestThreeBondsAreTheCeiling(t *testing.T) {
	frost := itemData{Type: "weapon", Attunement: true}
	if msg := attuneRefusal(true, frost, 2); msg != "" {
		t.Errorf("the third bond was refused: %s", msg)
	}
	if msg := attuneRefusal(true, frost, 3); msg == "" {
		t.Error("a fourth bond was accepted — three is the ceiling")
	}
}

/*
The two-handed grip (#189): one weapon owning both hands.
*/

func TestATwoHandedGripOwnsBothHands(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"bothhands", "mainhand", true},
		{"bothhands", "offhand", true},
		{"bothhands", "bothhands", true},
		{"mainhand", "offhand", false},
		{"bothhands", "armor", false},
		{"bothhands", "cloak", false},
		{"ring1", "ring2", false},
	}
	for _, c := range cases {
		if got := slotConflicts(c.a, c.b); got != c.want {
			t.Errorf("slotConflicts(%q, %q) = %v; want %v", c.a, c.b, got, c.want)
		}
		if got := slotConflicts(c.b, c.a); got != c.want {
			t.Errorf("slotConflicts(%q, %q) = %v; want %v — the relation is symmetric", c.b, c.a, got, c.want)
		}
	}
}

func TestAVersatileDieMustReadLikeOne(t *testing.T) {
	ok := map[string]interface{}{
		"type": "weapon", "category": "Martial", "damage": "1d8",
		"damageType": "slashing", "damage2": "1d10",
	}
	if msg := validateContentData(db.ContentKindItem, ok); msg != "" {
		t.Errorf("a versatile weapon was refused: %s", msg)
	}
	ok["damage2"] = "a big one"
	if msg := validateContentData(db.ContentKindItem, ok); msg == "" {
		t.Error("prose was accepted as a damage die")
	}
}
