package rules

import (
	"encoding/json"
	"strings"
)

/*
Spells a feature keeps always prepared (#361).

The Fiend Patron's Fiend Spells, a Cleric's domain spells, a Paladin's oath
spells: at set levels in the class, named spells are simply prepared, never
picked, never swapped, and never counted against the class's allowance. The
2024 books print them as a table; content declares the same table:

	"alwaysPrepared": [{"level": 3, "spells": ["Burning Hands", "Command"]}, …]

`level` is the level IN the class the declaration hangs on, the way pools and
forms read it, so a Cleric 5 / Warlock 3 has the Fiend's level-3 row and not
its level-5 one. Names, not ids, because a pack is written before anything
has an id — the way a subclass names its class. Resolution to spell rows is
the server's (a name the codex has never heard of simply grants nothing).
*/

// PreparedGrant is one row of an always-prepared table.
type PreparedGrant struct {
	Level  int      `json:"level"`
	Spells []string `json:"spells"`
}

type preparedDeclarations struct {
	AlwaysPrepared []PreparedGrant `json:"alwaysPrepared"`
}

// AlwaysPreparedIn reads the table out of one content entry's data. Content
// that declares none returns nil, which is nearly all of it.
func AlwaysPreparedIn(data []byte) []PreparedGrant {
	if len(data) == 0 {
		return nil
	}
	var d preparedDeclarations
	if err := json.Unmarshal(data, &d); err != nil {
		return nil
	}
	return d.AlwaysPrepared
}

// PreparedAt is every spell name the table grants at a level in its class,
// in table order, each name once.
func PreparedAt(grants []PreparedGrant, level int) []string {
	var out []string
	seen := map[string]bool{}
	for _, g := range grants {
		if g.Level > level {
			continue
		}
		for _, name := range g.Spells {
			key := strings.ToLower(strings.TrimSpace(name))
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, strings.TrimSpace(name))
		}
	}
	return out
}
