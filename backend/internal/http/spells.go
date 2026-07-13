package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// The class-data slice spellcasting needs. A class is a caster iff
// data.spellcaster is set; data.spellcasting may override the pick tables.
type castingRules struct {
	Spellcaster  string         `json:"spellcaster"`
	Spellcasting *rules.Casting `json:"spellcasting"`
}

// parseCasting reads a class's casting kind and pick tables (with fallbacks).
func parseCasting(classData []byte) (kind string, casting rules.Casting, isCaster bool) {
	var cr castingRules
	if err := json.Unmarshal(classData, &cr); err != nil || cr.Spellcaster == "" {
		return "", rules.Casting{}, false
	}
	casting = rules.FallbackCasting(cr.Spellcaster)
	if cr.Spellcasting != nil {
		casting = *cr.Spellcasting
	}
	return cr.Spellcaster, casting, true
}

type spellData struct {
	Level   int      `json:"level"`
	Classes []string `json:"classes"`
}

// validateSpellPicks checks new spell choices for a hero of the given class
// at the given level: visibility, kind, class list, spell level, duplicates,
// and cantrip/prepared caps (caps are ≤, so under-picked heroes self-heal).
// Returns a bad-request message ("" = ok) and the validated ids.
func (s *Server) validateSpellPicks(
	ctx context.Context,
	uid uuid.UUID,
	class db.RulesContent,
	atLevel int,
	existing []db.ListCharacterSpellsRow,
	newIDs []uuid.UUID,
) (string, []uuid.UUID, error) {
	kind, casting, isCaster := parseCasting(class.Data)
	if !isCaster {
		if len(newIDs) > 0 {
			return class.Name + " does not cast spells", nil, nil
		}
		return "", nil, nil
	}
	if atLevel < 1 {
		atLevel = 1
	}
	if atLevel > 20 {
		atLevel = 20
	}

	cantrips, leveled := 0, 0
	seen := map[uuid.UUID]bool{}
	for _, row := range existing {
		seen[row.ID] = true
		var d spellData
		_ = json.Unmarshal(row.Data, &d)
		if d.Level == 0 {
			cantrips++
		} else {
			leveled++
		}
	}

	maxSpellLevel := rules.MaxSpellLevel(kind, atLevel)
	for _, id := range newIDs {
		if seen[id] {
			return "a spell was chosen twice", nil, nil
		}
		seen[id] = true
		row, err := s.fetchVisibleContent(ctx, id, db.ContentKindSpell, uid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "unknown spell", nil, nil
			}
			return "that choice is not a spell", nil, nil
		}
		var d spellData
		if err := json.Unmarshal(row.Data, &d); err != nil {
			return row.Name + " has malformed spell data", nil, nil
		}
		onList := false
		for _, c := range d.Classes {
			if strings.EqualFold(c, class.Name) {
				onList = true
				break
			}
		}
		if !onList {
			return fmt.Sprintf("%s is not on the %s spell list", row.Name, class.Name), nil, nil
		}
		if d.Level == 0 {
			cantrips++
		} else {
			if d.Level > maxSpellLevel {
				return fmt.Sprintf("%s is level %d — beyond a level-%d %s's slots", row.Name, d.Level, atLevel, class.Name), nil, nil
			}
			leveled++
		}
	}

	if maxC := casting.Cantrips[atLevel-1]; cantrips > maxC {
		return fmt.Sprintf("%s knows at most %d cantrips at level %d", class.Name, maxC, atLevel), nil, nil
	}
	if maxP := casting.Prepared[atLevel-1]; leveled > maxP {
		return fmt.Sprintf("%s prepares at most %d spells at level %d", class.Name, maxP, atLevel), nil, nil
	}
	return "", newIDs, nil
}

// spellSlotsFor derives the caster block for a Character payload: the casting
// ability and max/used slots per spell level. Nil for non-casters.
func spellSlotsFor(classData []byte, level int32, used []int16) (*string, *[]api.SpellSlot) {
	kind, casting, isCaster := parseCasting(classData)
	if !isCaster {
		return nil, nil
	}
	table := rules.SlotTable(kind, int(level))
	slots := []api.SpellSlot{}
	for i, max := range table {
		u := 0
		if i < len(used) {
			u = int(used[i])
		}
		if max == 0 && u == 0 {
			continue
		}
		if u > max {
			u = max
		}
		slots = append(slots, api.SpellSlot{Level: i + 1, Max: max, Used: u})
	}
	ability := casting.Ability
	return &ability, &slots
}
