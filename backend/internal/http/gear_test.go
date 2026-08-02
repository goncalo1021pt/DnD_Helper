package http

import "testing"

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
