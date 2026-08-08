package http

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
A hero's armour class, derived from what they are actually wearing (#153).

The server used to answer this with `10 + DEX` whenever a hero was summoned
into a fight, because that is all it could see: `characters` stores raw ability
scores and an inventory, and the number a player reads on their sheet is worked
out in the browser and never sent anywhere. So a Barbarian reading 15 was
seated at 12, a Fighter in Chain Mail at 12 instead of 16, and the DM rolled
against the wrong number for the whole fight — failing toward hits landing that
should have missed, which is the direction nobody at the table can detect.

This is the sheet's own rule, moved to where the server can reach it. It is
mirrored by acFromEquipment in frontend/src/lib/derive.ts and held to it by
fixtures/rules/armor-class.json, so the tracker and the sheet cannot answer
differently again.

The pointer fields are deliberate rather than fussy. The client's rule
distinguishes an absent `ac` from an `ac` of 0 (`typeof d.ac === "number"`) and
an absent `shield` flag from `shield: false`, and plain ints would quietly
collapse those into each other — which is exactly the kind of transcription
drift the fixture exists to catch.
*/

// armorData is the armour-relevant slice of an item's content data.
type armorData struct {
	Type     string `json:"type"`
	Category string `json:"category"`
	AC       *int   `json:"ac"`
	ACBonus  *int   `json:"acBonus"`
	// The magic (#189): a +N on armor, a shield, or a worn item, applied only
	// when the item's attunement demand — if it makes one — is met.
	Bonus      *int   `json:"bonus"`
	Attunement bool   `json:"attunement"`
	Wear       string `json:"wear"`
}

// effectiveBonus is the +N an item actually contributes: its declared bonus,
// gated behind attunement when the item demands it. An unattuned Frost Brand
// is a well-made sword and nothing more.
func (d armorData) effectiveBonus(attuned bool) int {
	if d.Bonus == nil || (d.Attunement && !attuned) {
		return 0
	}
	return *d.Bonus
}

// unarmoredDefense is a feature that replaces the unarmoured base formula.
// Barbarian's is 10 + DEX + CON, Monk's 10 + DEX + WIS, Draconic Sorcery's
// scales 10 + DEX + CHA — three answers to one sentence, so the sentence is
// what content declares. `shield: false` means the benefit is lost the moment a
// shield is taken up (the Monk's is; the Barbarian's explicitly is not).
type unarmoredDefense struct {
	Base      *int     `json:"base"`
	Abilities []string `json:"abilities"`
	Shield    *bool    `json:"shield"`
}

// heroFeature is one entry from a class, subclass, species or background.
type heroFeature struct {
	Level            int               `json:"level"`
	Name             string            `json:"name"`
	UnarmoredDefense *unarmoredDefense `json:"unarmoredDefense"`
}

// featureSource is the shape every content entry that grants features shares.
// Classes and backgrounds call them features; a species calls them traits.
type featureSource struct {
	Features []heroFeature `json:"features"`
	Traits   []heroFeature `json:"traits"`
}

// earnedFeatures returns the entries a hero of this level has actually reached.
// Mirrors featuresOf in lib/derive.ts, including its default: a feature with no
// level stated is one the hero had at level 1.
func earnedFeatures(data []byte, level int) []heroFeature {
	if len(data) == 0 {
		return nil
	}
	var src featureSource
	if err := json.Unmarshal(data, &src); err != nil {
		return nil
	}
	out := make([]heroFeature, 0, len(src.Features)+len(src.Traits))
	for _, group := range [][]heroFeature{src.Features, src.Traits} {
		for _, f := range group {
			at := f.Level
			if at == 0 {
				at = 1
			}
			if at <= level {
				out = append(out, f)
			}
		}
	}
	return out
}

// wornItem is one inventory row, as far as armour is concerned.
type wornItem struct {
	Equipped bool
	Attuned  bool
	Data     []byte
}

// armorClass is the number on the sheet: worn armour and shield first, and the
// unarmoured formula — or a feature that replaces it — only when nothing is on.
//
// Light adds the whole DEX modifier, Medium at most 2 of it, Heavy none. A
// shield stacks on whatever the body is wearing, including on an unarmoured
// defence that survives carrying one.
func armorClass(items []wornItem, abilities map[string]int, features []heroFeature) int {
	mod := func(key string) int {
		score, ok := abilities[strings.ToLower(key)]
		if !ok {
			score = 10
		}
		return abilityMod(score)
	}

	dex := mod("dex")
	ac := 10 + dex
	armored := false
	shield := 0
	worn := 0

	for _, it := range items {
		if !it.Equipped || len(it.Data) == 0 {
			continue
		}
		var d armorData
		if err := json.Unmarshal(it.Data, &d); err != nil {
			continue
		}
		eff := d.effectiveBonus(it.Attuned)
		switch {
		case d.Type == "armor" && d.AC != nil:
			armored = true
			switch d.Category {
			case "Light":
				ac = *d.AC + dex
			case "Medium":
				ac = *d.AC + min(dex, 2)
			default:
				ac = *d.AC
			}
			ac += eff
		case d.Type == "shield":
			shield = 2
			if d.ACBonus != nil {
				shield = *d.ACBonus
			}
			shield += eff
		case d.Type == "gear" && d.Wear != "":
			// A Ring or Cloak of Protection: worn, and stacking on anything —
			// its bonus is to the wearer, not to a suit of armor.
			worn += eff
		}
	}

	if !armored {
		for _, f := range features {
			ud := f.UnarmoredDefense
			if ud == nil || len(ud.Abilities) == 0 {
				continue
			}
			// A Monk with a shield is just a Monk in a shirt.
			if shield > 0 && ud.Shield != nil && !*ud.Shield {
				continue
			}
			base := 10
			if ud.Base != nil {
				base = *ud.Base
			}
			for _, a := range ud.Abilities {
				base += mod(a)
			}
			// Better, never worse: a feature is a benefit, not a cap.
			if base > ac {
				ac = base
			}
		}
	}
	return ac + shield + worn
}

// characterAbilities reads a hero's scores into the shape the rule wants.
// A hero with no scores at all — a quick-add, added to the party by name — is
// read as a commoner rather than refused, since the DM may still want them in
// the fight.
func characterAbilities(ch db.Character) map[string]int {
	score := func(v *int16) int {
		if v == nil {
			return 10
		}
		return int(*v)
	}
	return map[string]int{
		"str": score(ch.Strength), "dex": score(ch.Dexterity), "con": score(ch.Constitution),
		"int": score(ch.Intelligence), "wis": score(ch.Wisdom), "cha": score(ch.Charisma),
	}
}

// heroArmorClass derives one hero's AC the way their sheet does: their equipped
// kit, plus any feature from the four sheet columns that replaces the
// unarmoured formula.
func (s *Server) heroArmorClass(ctx context.Context, ch db.Character) (int32, error) {
	rows, err := s.queries.ListCharacterItems(ctx, ch.ID)
	if err != nil {
		return 0, err
	}
	items := make([]wornItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, wornItem{Equipped: r.Equipped, Attuned: r.Attuned, Data: r.Data})
	}

	var features []heroFeature
	for _, id := range sheetColumnIDs(ch) {
		content, err := s.queries.GetContent(ctx, id)
		if err != nil {
			// A column pointing at deleted content is not a reason to refuse the
			// hero a place in the fight; they just lose that source's features.
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return 0, err
		}
		features = append(features, earnedFeatures(content.Data, int(ch.Level))...)
	}

	return int32(armorClass(items, characterAbilities(ch), features)), nil
}
