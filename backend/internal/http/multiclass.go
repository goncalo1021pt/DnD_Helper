package http

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

/*
Multiclassing (#190), the read half.

A hero is a list of classes. `character_classes` holds the levels;
`characters.class_id` keeps the different fact that it is the class they
*started* as, which the 2024 rules single out — you take full starting
proficiencies from that one and a reduced set from every class after it
(PHB 2024, p.44).

Everything here is display and resolution. Nothing in this file can make a
hero multiclassed; taking a level in a second class is the next step, and
until it lands every hero has exactly one row and reads exactly as before.
*/

// heroClass is the shared shape of the three ListCharacterClasses* rows. sqlc
// generates a distinct struct per query even when the columns are identical,
// so the conversion happens once, here, rather than at each call site.
type heroClass struct {
	CharacterID  uuid.UUID
	ClassID      uuid.UUID
	SubclassID   pgtype.UUID
	Level        int16
	Position     int16
	ClassName    string
	ClassData    []byte
	SubclassName *string
}

func classesFromCampaign(rows []db.ListCharacterClassesForCampaignRow) []heroClass {
	out := make([]heroClass, 0, len(rows))
	for _, r := range rows {
		out = append(out, heroClass(r))
	}
	return out
}

func classesFromOwner(rows []db.ListCharacterClassesForOwnerRow) []heroClass {
	out := make([]heroClass, 0, len(rows))
	for _, r := range rows {
		out = append(out, heroClass(r))
	}
	return out
}

func classesFromCharacter(rows []db.ListCharacterClassesRow) []heroClass {
	out := make([]heroClass, 0, len(rows))
	for _, r := range rows {
		out = append(out, heroClass(r))
	}
	return out
}

// byCharacter groups a bulk read, so a roster of six heroes costs one query
// rather than six.
func byCharacter(rows []heroClass) map[uuid.UUID][]heroClass {
	out := map[uuid.UUID][]heroClass{}
	for _, r := range rows {
		out[r.CharacterID] = append(out[r.CharacterID], r)
	}
	return out
}

// classesFor reads one hero's classes. Best-effort in the same way
// classDataFor is: a hero whose class rows cannot be read is a hero with a
// thinner sheet, not a request that fails.
func (s *Server) classesFor(ctx context.Context, c db.Character) []heroClass {
	rows, err := s.queries.ListCharacterClasses(ctx, c.ID)
	if err != nil {
		return nil
	}
	return classesFromCharacter(rows)
}

// toAPICharacterClasses renders a hero's classes for the sheet. `starting` is
// resolved against characters.class_id rather than position 0 — position is
// the order they were taken, and those agree today, but only one of them is
// the fact the proficiency rules actually ask about.
func toAPICharacterClasses(rows []heroClass, startingClassID pgtype.UUID) []api.CharacterClass {
	out := make([]api.CharacterClass, 0, len(rows))
	for _, r := range rows {
		entry := api.CharacterClass{
			ClassId:   r.ClassID,
			ClassName: r.ClassName,
			Level:     int(r.Level),
		}
		if r.SubclassID.Valid {
			id := uuid.UUID(r.SubclassID.Bytes)
			entry.SubclassId = &id
		}
		if r.SubclassName != nil {
			name := *r.SubclassName
			entry.SubclassName = &name
		}
		starting := startingClassID.Valid && uuid.UUID(startingClassID.Bytes) == r.ClassID
		entry.Starting = &starting
		out = append(out, entry)
	}
	return out
}

// TotalLevel sums a hero's class levels. characters.level is meant to equal
// this; where they disagree the rows are the truth, because they are what a
// level-up writes.
func totalLevel(rows []heroClass) int {
	total := 0
	for _, r := range rows {
		total += int(r.Level)
	}
	return total
}

// hitDicePoolsOf resolves the dice from classes already in hand — the maximum
// from their levels and declared dice, the used counts from what was spent.
func hitDicePoolsOf(classes []heroClass, level int, spentRaw []byte) []rules.HitDicePool {
	dice := make([]rules.ClassDie, 0, len(classes))
	for _, k := range classes {
		var cr struct {
			HitDie int `json:"hitDie"`
		}
		_ = json.Unmarshal(k.ClassData, &cr)
		dice = append(dice, rules.ClassDie{Die: cr.HitDie, Levels: int(k.Level)})
	}
	return rules.HitDicePools(dice, level, decodeHitDiceSpent(spentRaw))
}

// hitDiceFor is the same for a hero whose classes have not been read yet. A
// hero with no class content falls back to their level in d8, which is what
// the short rest has always rolled for a quick-add hero.
func (s *Server) hitDiceFor(ctx context.Context, c db.Character) []rules.HitDicePool {
	return hitDicePoolsOf(s.classesFor(ctx, c), int(c.Level), c.HitDiceSpent)
}

// toAPIHitDice is the wire shape of the pools.
func toAPIHitDice(pools []rules.HitDicePool) []api.HitDicePool {
	out := make([]api.HitDicePool, 0, len(pools))
	for _, p := range pools {
		out = append(out, api.HitDicePool{Die: p.Die, Max: p.Max, Used: p.Used})
	}
	return out
}

// decodeHitDiceSpent reads the JSONB column: die size (as a string key) to the
// number spent. Unreadable state counts as nothing spent rather than failing
// a rest — a hero should not be unable to sleep because a column is malformed.
func decodeHitDiceSpent(raw []byte) map[int]int {
	out := map[int]int{}
	if len(raw) == 0 {
		return out
	}
	var byKey map[string]int
	if err := json.Unmarshal(raw, &byKey); err != nil {
		return out
	}
	for key, n := range byKey {
		if die, err := strconv.Atoi(key); err == nil && die > 0 && n > 0 {
			out[die] = n
		}
	}
	return out
}

// encodeHitDiceSpent writes it back, dropping zeroes so an untouched hero
// stores {} rather than a row of noughts.
func encodeHitDiceSpent(spent map[int]int) ([]byte, error) {
	byKey := map[string]int{}
	for die, n := range spent {
		if n > 0 {
			byKey[strconv.Itoa(die)] = n
		}
	}
	return json.Marshal(byKey)
}

// parseHitDiceRequest turns the request's {"10": 2} into die-keyed counts,
// refusing a die the hero does not have rather than silently ignoring it —
// asking to spend a d12 you were never granted is a mistake worth hearing.
func parseHitDiceRequest(body *map[string]int, pools []rules.HitDicePool) (map[int]int, string) {
	want := map[int]int{}
	if body == nil {
		return want, ""
	}
	held := map[int]bool{}
	for _, p := range pools {
		if p.Max > 0 {
			held[p.Die] = true
		}
	}
	for key, n := range *body {
		if n <= 0 {
			continue
		}
		die, err := strconv.Atoi(key)
		if err != nil || die < 1 {
			return nil, fmt.Sprintf("%q is not a die size", key)
		}
		if !held[die] {
			return nil, fmt.Sprintf("this hero has no d%d to spend", die)
		}
		want[die] = n
	}
	return want, ""
}

/*
castersOf describes each class a hero casts from, and which of their spells
belong to it (#190).

The per-class allowances are read at the hero's level IN that class, because
"you determine what spells you can prepare for each class individually, as if
you were a single-classed member of that class" (PHB 2024, p.44). The slots
they go into are shared and can be higher than any of these — a Ranger 4 /
Sorcerer 3 may hold a level 3 slot with no level 3 spell to put in it, which
is why maxSpellLevel is reported per class rather than inferred from the pool.

Spells recorded before class_id existed carry the starting class, so an
existing single-classed hero's list groups exactly as it always displayed.
*/
func castersOf(classes []heroClass, spells []db.ListCharacterSpellsRow, startingClass pgtype.UUID) []api.Spellcaster {
	out := []api.Spellcaster{}
	for _, k := range classes {
		kind, casting, isCaster := parseCasting(k.ClassData)
		if !isCaster {
			continue
		}
		level := int(k.Level)
		if level < 1 {
			level = 1
		}
		if level > 20 {
			level = 20
		}
		cantrips := casting.Cantrips[level-1]
		prepared := casting.Prepared[level-1]
		maxLevel := rules.MaxSpellLevel(kind, level)

		ids := []uuid.UUID{}
		for _, sp := range spells {
			owner := sp.ClassID
			// A spell with no owner belongs to the class the hero started as.
			if !owner.Valid {
				owner = startingClass
			}
			if owner.Valid && uuid.UUID(owner.Bytes) == k.ClassID {
				ids = append(ids, sp.ID)
			}
		}

		out = append(out, api.Spellcaster{
			ClassId:       k.ClassID,
			ClassName:     k.ClassName,
			Ability:       casting.Ability,
			CantripsKnown: &cantrips,
			Prepared:      &prepared,
			MaxSpellLevel: &maxLevel,
			SpellIds:      ids,
		})
	}
	return out
}

// classLine renders the line a sheet header shows: "Rogue 5 / Wizard 3", or
// just "Rogue 5" for the single-classed, which is nearly everyone. Empty for
// a quick-add hero, whose freeform `class` text is all they have.
func classLine(rows []heroClass) string {
	if len(rows) == 0 {
		return ""
	}
	parts := make([]string, 0, len(rows))
	for _, r := range rows {
		parts = append(parts, r.ClassName+" "+strconv.Itoa(int(r.Level)))
	}
	return strings.Join(parts, " / ")
}
