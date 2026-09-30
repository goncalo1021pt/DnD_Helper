package rules

import "encoding/json"

/*
Mystic Arcanum, and anything shaped like it (#362).

From Warlock 11 a Warlock learns one spell of level 6, then 7 at 13, 8 at 15
and 9 at 17, each cast once per Long Rest without a slot. Pact slots stop at
level 5, so these spells sit above everything the class may otherwise
prepare: a pick above the class's slot ceiling is an arcanum by definition,
and is stored in the spell list like any other pick. Content declares when
each level opens, so a homebrew caster can reuse it:

	"arcanum": [{"level": 11, "spellLevel": 6}, {"level": 13, "spellLevel": 7}, …]

`level` is the level in the class, like everything casting reads. The once-
per-rest cast is a pool, declared beside it; this file only says which spell
levels are open to an arcanum pick.
*/

// ArcanumGrant opens one spell level to a single arcanum pick.
type ArcanumGrant struct {
	Level      int `json:"level"`
	SpellLevel int `json:"spellLevel"`
}

type arcanumDeclarations struct {
	Arcanum []ArcanumGrant `json:"arcanum"`
}

// ArcanumIn reads the declaration out of one content entry's data.
func ArcanumIn(data []byte) []ArcanumGrant {
	if len(data) == 0 {
		return nil
	}
	var d arcanumDeclarations
	if err := json.Unmarshal(data, &d); err != nil {
		return nil
	}
	return d.Arcanum
}

// ArcanumOpen is the set of spell levels open to an arcanum pick at a level
// in the class — each holds exactly one spell.
func ArcanumOpen(grants []ArcanumGrant, level int) map[int]bool {
	out := map[int]bool{}
	for _, g := range grants {
		if g.Level <= level && g.SpellLevel >= 1 && g.SpellLevel <= 9 {
			out[g.SpellLevel] = true
		}
	}
	return out
}
