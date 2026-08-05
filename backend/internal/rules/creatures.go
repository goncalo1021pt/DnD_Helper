package rules

/*
What a feature grants in the way of a second stat block, and how that block is
resolved for the hero carrying it.

Content declares; this file interprets. A class, subclass, feat, species or
item may carry either declaration in its `data`:

	"companions": [
	  {"name": "Steel Defender", "role": "companion", "level": 3}
	]

	"forms": {
	  "feature": "Wild Shape", "type": "Beast", "tempHp": "level",
	  "table": [
	    {"level": 2, "known": 4, "maxCR": 0.25, "fly": false},
	    {"level": 4, "known": 6, "maxCR": 0.5,  "fly": false},
	    {"level": 8, "known": 8, "maxCR": 1,    "fly": true}
	  ]
	}

`companions` names stat blocks by name, which is exactly how the rest of the
pack format points at things (a subclass names its class, a spell names its
classes). So an Artificer pack ships a `monster` entry called Steel Defender
and a `subclass` entry that names it, and nothing here needs to know that
Artificers exist. `forms` describes a shapeshifter's allowance instead of
listing blocks, because the eligible list is "every Beast under CR 1/4" and
enumerating it in content would go stale the moment a book adds a badger.
*/

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// CompanionGrant is one creature a feature hands the hero outright.
type CompanionGrant struct {
	Name    string `json:"name"`
	Role    string `json:"role"`    // form | companion | summon; defaults to companion
	Level   int    `json:"level"`   // hero level it becomes available at
	Summary string `json:"summary"` // optional line for the picker
}

// FormRow is one step of a shapeshifter's allowance table.
type FormRow struct {
	Level int     `json:"level"`
	Known int     `json:"known"`
	MaxCR float64 `json:"maxCR"`
	Fly   bool    `json:"fly"`
}

// FormsGrant is a shapeshifting feature: which creatures qualify, how many are
// known, and what assuming one gives you.
type FormsGrant struct {
	Feature string    `json:"feature"`
	Type    string    `json:"type"`   // creature type the forms are drawn from
	TempHP  string    `json:"tempHp"` // expression, evaluated per hero
	Table   []FormRow `json:"table"`
}

// FormAllowance is a FormsGrant read at one hero's level.
type FormAllowance struct {
	Feature string
	Type    string
	Known   int
	MaxCR   float64
	Fly     bool
	TempHP  int
}

// declarations is the slice of a content entry's data this file reads.
type declarations struct {
	Companions []CompanionGrant `json:"companions"`
	Forms      *FormsGrant      `json:"forms"`
}

// GrantsIn reads the creature declarations out of one content entry's data.
// Content that declares neither returns zero values, which is every entry in
// the library today.
func GrantsIn(data []byte) ([]CompanionGrant, *FormsGrant) {
	if len(data) == 0 {
		return nil, nil
	}
	var d declarations
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, nil
	}
	return d.Companions, d.Forms
}

// At reads the allowance a shapeshifter has at a given level — the last row
// of the table they have reached. A hero below the first row has none.
func (g *FormsGrant) At(level int, scope Scope) (FormAllowance, bool) {
	if g == nil {
		return FormAllowance{}, false
	}
	out := FormAllowance{Feature: g.Feature, Type: g.Type}
	reached := false
	for _, row := range g.Table {
		if level >= row.Level {
			out.Known, out.MaxCR, out.Fly = row.Known, row.MaxCR, row.Fly
			reached = true
		}
	}
	if !reached {
		return FormAllowance{}, false
	}
	if g.TempHP != "" {
		if v, err := Eval(g.TempHP, scope); err == nil {
			out.TempHP = v
		}
	}
	return out, true
}

// EligibleForm reports whether a stat block qualifies for an allowance: right
// creature type, within the CR ceiling, and grounded unless flight is allowed.
func (a FormAllowance) EligibleForm(data []byte) bool {
	var block struct {
		Type    string  `json:"type"`
		CRValue float64 `json:"crValue"`
		Speed   string  `json:"speed"`
	}
	if err := json.Unmarshal(data, &block); err != nil {
		return false
	}
	if a.Type != "" && !strings.Contains(strings.ToLower(block.Type), strings.ToLower(a.Type)) {
		return false
	}
	if block.CRValue > a.MaxCR+1e-9 {
		return false
	}
	if !a.Fly && strings.Contains(strings.ToLower(block.Speed), "fly") {
		return false
	}
	return true
}

// abilityKeys is the one nested object worth merging field by field: a player
// molding a companion's Strength should not blank the other five.
const abilityKeys = "abilities"

// ResolveBlock produces the stat block a hero actually plays, from the three
// layers that make it: the library entry, its `scale` expressions evaluated
// against this hero, and the player's own overrides on top.
//
// Returns the resolved block and the names of the fields the player has
// molded, so the sheet can mark which numbers are theirs rather than the
// book's. A bad expression is not fatal — the unscaled value stands and the
// error is reported, because a companion with one stale number still beats a
// sheet that refuses to load.
func ResolveBlock(contentData []byte, overrides map[string]any, scope Scope) (map[string]any, []string, error) {
	block := map[string]any{}
	if len(contentData) > 0 {
		if err := json.Unmarshal(contentData, &block); err != nil {
			return nil, nil, fmt.Errorf("unreadable stat block: %w", err)
		}
	}

	// Scale: field name to expression, evaluated then written into the block.
	var scaleErr error
	if raw, ok := block["scale"].(map[string]any); ok {
		for field, expr := range raw {
			text, ok := expr.(string)
			if !ok {
				continue
			}
			v, err := Eval(text, scope)
			if err != nil {
				if scaleErr == nil {
					scaleErr = fmt.Errorf("%s: %w", field, err)
				}
				continue
			}
			block[field] = v
		}
		// An authoring detail, not something to render on a sheet.
		delete(block, "scale")
	}

	molded := make([]string, 0, len(overrides))
	for field, value := range overrides {
		molded = append(molded, field)
		if field == abilityKeys {
			patch, okPatch := value.(map[string]any)
			base, okBase := block[abilityKeys].(map[string]any)
			if okPatch && okBase {
				for k, v := range patch {
					base[k] = v
				}
				block[abilityKeys] = base
				continue
			}
		}
		block[field] = value
	}
	return block, molded, scaleErr
}

// BlockHP reads the hit points off a resolved block, for seeding a new
// companion's pool. Blocks write it as a number; a homebrew one might write
// "22 (4d8+4)", so a leading integer counts too.
func BlockHP(block map[string]any) (int, bool) {
	switch v := block["hp"].(type) {
	case float64:
		return int(math.Floor(v)), true
	case int:
		return v, true
	case string:
		head := strings.TrimSpace(v)
		cut := strings.IndexFunc(head, func(r rune) bool { return r < '0' || r > '9' })
		if cut > 0 {
			head = head[:cut]
		}
		var n int
		if _, err := fmt.Sscanf(head, "%d", &n); err == nil {
			return n, true
		}
	}
	return 0, false
}
