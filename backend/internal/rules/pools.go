package rules

/*
Expendable resource pools — Rages, Channel Divinity, Focus Points — and what
a hero's level makes of them.

Content declares; this file interprets. A class, subclass, feat, species or
item may carry the declaration in its `data`, beside `companions` and `forms`:

	"pools": [
	  {"name": "Rages", "uses": [2,2,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6,6,6],
	   "shortRest": "one"},
	  {"name": "Focus Points", "level": 2, "uses": "level", "shortRest": "all"},
	  {"name": "Lay On Hands", "uses": "5 * level"}
	]

`uses` is either a scale expression evaluated against the hero (level, prof,
ability modifiers — see scale.go) or a table of exactly twenty numbers, one
per level, for progressions like Rages that no formula expresses. `level` is
the level the pool appears at; a table encodes the same thing with leading
zeros. `shortRest` says what a short rest hands back — "none" (the default),
"one" use, or "all" of them. A long rest always refills everything.

Deliberately NOT here: the featuresTable display strings ("1d6", "—") stay a
table to read, never a pool to spend. Pools are their own declaration so a
pack can ship them for a class this repo has never heard of, and so the
engine never guesses game math out of prose.
*/

import (
	"encoding/json"
	"fmt"
)

// Short-rest refill kinds. A long rest refills every pool regardless.
const (
	ShortRestNone = "none"
	ShortRestOne  = "one"
	ShortRestAll  = "all"
)

// PoolUses is a pool's maximum: an expression over the hero, or a per-level
// table of twenty values. Exactly one side is set.
type PoolUses struct {
	Expr  string
	Table []int
}

func (u *PoolUses) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		u.Expr = s
		return nil
	}
	var table []int
	if err := json.Unmarshal(b, &table); err == nil {
		u.Table = table
		return nil
	}
	return fmt.Errorf("uses must be an expression or a table of numbers")
}

func (u PoolUses) MarshalJSON() ([]byte, error) {
	if u.Table != nil {
		return json.Marshal(u.Table)
	}
	return json.Marshal(u.Expr)
}

// PoolGrant is one expendable pool a feature hands the hero.
type PoolGrant struct {
	Name      string   `json:"name"`
	Uses      PoolUses `json:"uses"`
	Level     int      `json:"level"`     // hero level it appears at; 0 means 1
	ShortRest string   `json:"shortRest"` // none | one | all; defaults to none
	// ShortRestLevel is the hero level the shortRest rule starts applying at —
	// a Bard's inspiration waits for the night until Font of Inspiration
	// arrives at 5. Zero means "as soon as the pool exists".
	ShortRestLevel int `json:"shortRestLevel"`
}

// poolDeclarations is the slice of a content entry's data this file reads.
type poolDeclarations struct {
	Pools []PoolGrant `json:"pools"`
}

// PoolsIn reads the pool declarations out of one content entry's data.
// Content that declares none returns nil, which is most of the library.
func PoolsIn(data []byte) []PoolGrant {
	if len(data) == 0 {
		return nil
	}
	var d poolDeclarations
	if err := json.Unmarshal(data, &d); err != nil {
		return nil
	}
	return d.Pools
}

// Max is the pool's ceiling for one hero. Zero means the hero does not have
// the pool yet — below its level, before a table's first non-zero entry, or
// behind an expression that will not evaluate (imports refuse those, but data
// predating the check must read as absent, not as a crash).
func (g PoolGrant) Max(scope Scope) int {
	if g.Level > 0 && scope.Level < g.Level {
		return 0
	}
	if g.Uses.Table != nil {
		idx := scope.Level
		if idx < 1 {
			idx = 1
		}
		if idx > len(g.Uses.Table) {
			idx = len(g.Uses.Table)
		}
		if idx == 0 {
			return 0
		}
		v := g.Uses.Table[idx-1]
		if v < 0 {
			return 0
		}
		return v
	}
	v, err := Eval(g.Uses.Expr, scope)
	if err != nil || v < 0 {
		return 0
	}
	return v
}

// ShortRestKindAt normalises the declaration's refill rule for one hero: the
// declared kind once the hero has reached shortRestLevel, none before it.
func (g PoolGrant) ShortRestKindAt(level int) string {
	if g.ShortRestLevel > 0 && level < g.ShortRestLevel {
		return ShortRestNone
	}
	switch g.ShortRest {
	case ShortRestOne, ShortRestAll:
		return g.ShortRest
	default:
		return ShortRestNone
	}
}
