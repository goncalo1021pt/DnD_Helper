package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// The content-data slice spellcasting needs — read off a class, or off a
// subclass when the casting rides there (#220). A caster is whatever sets
// data.spellcaster; data.spellcasting may override the pick tables.
// data.spellList lets a class (e.g. homebrew Artificer) claim spells by name
// when the spells' own classes arrays don't know about it; data.spellListClass
// names another class whose whole list this caster reads — how an Eldritch
// Knight, a Fighter, casts Wizard spells.
type castingRules struct {
	Spellcaster    string            `json:"spellcaster"`
	Spellcasting   *rules.Casting    `json:"spellcasting"`
	SpellList      []string          `json:"spellList"`
	SpellListClass string            `json:"spellListClass"`
	SpellChanges   *spellChangeRules `json:"spellChanges"`
}

/*
When a caster may trade one spell for another, and how many. The 2024 rules
split the field: a Cleric re-prepares its whole list on a Long Rest, a Paladin
swaps one, and a Bard cannot do it at all until it gains a level. Only the
Wizard may trade a cantrip on a Long Rest.

The class entries carry this as data because prose can't gate a swap.
*/
type spellChangeRule struct {
	// "long-rest" or "level-up".
	When string `json:"when"`
	// A number, or the string "any" for an unlimited re-prepare.
	Count json.RawMessage `json:"count"`
}

type spellChangeRules struct {
	Prepared *spellChangeRule `json:"prepared"`
	Cantrips *spellChangeRule `json:"cantrips"`
}

// unlimitedSwaps is the allowance for a class that re-prepares its whole list.
const unlimitedSwaps = -1

// allowance returns how many swaps this rule permits on the given trigger.
// Zero means none — either the rule is absent or it fires on the other trigger.
func (r *spellChangeRule) allowance(trigger string) int {
	if r == nil || r.When != trigger {
		return 0
	}
	if len(r.Count) == 0 {
		return 1
	}
	var n int
	if err := json.Unmarshal(r.Count, &n); err == nil {
		return n
	}
	var word string
	if err := json.Unmarshal(r.Count, &word); err == nil && strings.EqualFold(word, "any") {
		return unlimitedSwaps
	}
	return 0
}

// spellChangesFor reads a class's rule. A caster whose data predates the field
// — homebrew, an imported pack — falls back to the commonest 2024 shape:
// re-prepare freely on a Long Rest, no cantrip swapping.
func spellChangesFor(cr castingRules) spellChangeRules {
	if cr.SpellChanges != nil {
		return *cr.SpellChanges
	}
	return spellChangeRules{
		Prepared: &spellChangeRule{When: "long-rest", Count: json.RawMessage(`"any"`)},
	}
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

// spellsOfClass narrows a hero's spell rows to one class's own list — a
// class's caps are counted against ITS spells, never the whole grimoire
// (#241). Rows from before spells carried a class (NULL class_id) read as
// the starting class's, the class they were forged under.
func spellsOfClass(rows []db.ListCharacterSpellsRow, classID uuid.UUID, startingClass pgtype.UUID) []db.ListCharacterSpellsRow {
	out := make([]db.ListCharacterSpellsRow, 0, len(rows))
	for _, r := range rows {
		owner := startingClass
		if r.ClassID.Valid {
			owner = r.ClassID
		}
		if owner.Valid && uuid.UUID(owner.Bytes) == classID {
			out = append(out, r)
		}
	}
	return out
}

// castingDataOf returns the data block a hero-class's casting is declared on:
// the class's own when it sets data.spellcaster, else its subclass's when that
// does — an Eldritch Knight is a Fighter whose casting rides on the subclass
// (#220). nil when neither casts.
func castingDataOf(k heroClass) []byte {
	if _, _, ok := parseCasting(k.ClassData); ok {
		return k.ClassData
	}
	if _, _, ok := parseCasting(k.SubclassData); ok {
		return k.SubclassData
	}
	return nil
}

// spellOnList says whether this caster may take a spell: the spell's own
// classes array names the class — or the class whose whole list the caster
// reads (data.spellListClass) — or the caster's data.spellList claims it by
// name.
func spellOnList(d spellData, spellName, className string, cr castingRules) bool {
	for _, c := range d.Classes {
		if strings.EqualFold(c, className) {
			return true
		}
		if cr.SpellListClass != "" && strings.EqualFold(c, cr.SpellListClass) {
			return true
		}
	}
	for _, n := range cr.SpellList {
		if strings.EqualFold(n, spellName) {
			return true
		}
	}
	return false
}

// spellListName is the list a refusal names: the class whose spells the
// caster reads when they borrow one, else the class itself.
func spellListName(className string, cr castingRules) string {
	if cr.SpellListClass != "" {
		return cr.SpellListClass
	}
	return className
}

type spellData struct {
	Level   int      `json:"level"`
	Classes []string `json:"classes"`
}

// codexRefuses returns a readable refusal if the campaign's codex bars any of
// these spells, or "" when all are admitted. A zero campaignID means the hero
// sits at no table, so no codex rules the pick — the forge is unseated, and its
// bans bite at the seat door. Strict seating's contract is that banned content
// is refused wherever it is picked, so every pick and swap runs through here
// (#239).
func (s *Server) codexRefuses(ctx context.Context, campaignID uuid.UUID, ids []uuid.UUID) (string, error) {
	if campaignID == uuid.Nil || len(ids) == 0 {
		return "", nil
	}
	blockers, err := s.codexBlockers(ctx, campaignID, ids)
	if err != nil {
		return "", err
	}
	if len(blockers) > 0 {
		return blockers[0].row.Name + " is not admitted by the campaign's codex — ask the DM", nil
	}
	return "", nil
}

// validateSpellPicks checks new spell choices for a hero of the given class
// at the given level: visibility, kind, class list, spell level, duplicates,
// and cantrip/prepared caps (caps are ≤, so under-picked heroes self-heal).
// `subclassData` carries the hero's subclass in that class (nil without one),
// because the casting may be declared there rather than on the class (#220).
// Returns a bad-request message ("" = ok) and the validated ids.
func (s *Server) validateSpellPicks(
	ctx context.Context,
	uid uuid.UUID,
	campaignID uuid.UUID,
	class db.RulesContent,
	subclassData []byte,
	atLevel int,
	existing []db.ListCharacterSpellsRow,
	newIDs []uuid.UUID,
) (string, []uuid.UUID, error) {
	castingData := class.Data
	kind, casting, isCaster := parseCasting(castingData)
	if !isCaster {
		kind, casting, isCaster = parseCasting(subclassData)
		castingData = subclassData
	}
	if !isCaster {
		if len(newIDs) > 0 {
			return class.Name + " does not cast spells", nil, nil
		}
		return "", nil, nil
	}
	var cr castingRules
	_ = json.Unmarshal(castingData, &cr)
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
		if !spellOnList(d, row.Name, class.Name, cr) {
			return fmt.Sprintf("%s is not on the %s spell list", row.Name, spellListName(class.Name, cr)), nil, nil
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
	// A seated hero's picks answer to the table's codex like everything else.
	if msg, err := s.codexRefuses(ctx, campaignID, newIDs); err != nil {
		return "", nil, err
	} else if msg != "" {
		return msg, nil, nil
	}
	return "", newIDs, nil
}

// swapResult is a validated set of trades, split into what leaves the hero's
// list and what joins it.
type swapResult struct {
	Out []uuid.UUID
	In  []uuid.UUID
}

// validateSpellSwaps checks a set of one-for-one spell trades against the
// class's spellChanges rule for the given trigger ("long-rest" or "level-up").
//
// A swap keeps the list the same size, so the cantrip/prepared caps can't be
// broken by one; what has to hold is that the class may trade at all on this
// trigger, that it isn't trading more than its allowance, that the hero really
// knows what it's giving up, and that a cantrip is only ever traded for
// another cantrip.
func (s *Server) validateSpellSwaps(
	ctx context.Context,
	uid uuid.UUID,
	campaignID uuid.UUID,
	class db.RulesContent,
	subclassData []byte,
	atLevel int,
	existing []db.ListCharacterSpellsRow,
	swaps []api.SpellSwap,
	trigger string,
) (string, swapResult, error) {
	var out swapResult
	if len(swaps) == 0 {
		return "", out, nil
	}
	castingData := class.Data
	kind, _, isCaster := parseCasting(castingData)
	if !isCaster {
		kind, _, isCaster = parseCasting(subclassData)
		castingData = subclassData
	}
	if !isCaster {
		return class.Name + " does not cast spells", out, nil
	}
	var cr castingRules
	_ = json.Unmarshal(castingData, &cr)
	changes := spellChangesFor(cr)

	if atLevel < 1 {
		atLevel = 1
	}
	if atLevel > 20 {
		atLevel = 20
	}

	// What the hero currently knows, and whether each is a cantrip.
	known := map[uuid.UUID]bool{}
	isCantrip := map[uuid.UUID]bool{}
	name := map[uuid.UUID]string{}
	for _, row := range existing {
		var d spellData
		_ = json.Unmarshal(row.Data, &d)
		known[row.ID] = true
		isCantrip[row.ID] = d.Level == 0
		name[row.ID] = row.Name
	}

	maxSpellLevel := rules.MaxSpellLevel(kind, atLevel)
	usedOut := map[uuid.UUID]bool{}
	usedIn := map[uuid.UUID]bool{}
	cantripSwaps, preparedSwaps := 0, 0

	for _, sw := range swaps {
		outID, inID := uuid.UUID(sw.Replace), uuid.UUID(sw.With)
		if outID == inID {
			return "a spell can't be swapped for itself", out, nil
		}
		if !known[outID] {
			return "that hero doesn't know the spell being replaced", out, nil
		}
		if usedOut[outID] {
			return name[outID] + " is being replaced twice", out, nil
		}
		if usedIn[inID] {
			return "the same spell was chosen twice as a replacement", out, nil
		}
		if known[inID] && !usedOut[inID] {
			return "that hero already knows the replacement spell", out, nil
		}
		usedOut[outID], usedIn[inID] = true, true

		row, err := s.fetchVisibleContent(ctx, inID, db.ContentKindSpell, uid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "unknown spell", out, nil
			}
			return "that choice is not a spell", out, nil
		}
		var d spellData
		if err := json.Unmarshal(row.Data, &d); err != nil {
			return row.Name + " has malformed spell data", out, nil
		}
		if !spellOnList(d, row.Name, class.Name, cr) {
			return fmt.Sprintf("%s is not on the %s spell list", row.Name, spellListName(class.Name, cr)), out, nil
		}
		if d.Level > maxSpellLevel {
			return fmt.Sprintf("%s is level %d — beyond a level-%d %s's slots", row.Name, d.Level, atLevel, class.Name), out, nil
		}
		// A cantrip and a prepared spell are different currencies.
		if isCantrip[outID] != (d.Level == 0) {
			if isCantrip[outID] {
				return fmt.Sprintf("%s is a cantrip — it can only be traded for another cantrip", name[outID]), out, nil
			}
			return fmt.Sprintf("%s is a cantrip — it can't replace a prepared spell", row.Name), out, nil
		}
		if d.Level == 0 {
			cantripSwaps++
		} else {
			preparedSwaps++
		}
		out.Out = append(out.Out, outID)
		out.In = append(out.In, inID)
	}

	occasion := "a Long Rest"
	if trigger == "level-up" {
		occasion = "gaining a level"
	}
	check := func(count int, rule *spellChangeRule, one, many string) string {
		if count == 0 {
			return ""
		}
		allowed := rule.allowance(trigger)
		if allowed == 0 {
			return fmt.Sprintf("%s can't change its %s on %s", class.Name, many, occasion)
		}
		if allowed != unlimitedSwaps && count > allowed {
			noun := many
			if allowed == 1 {
				noun = one
			}
			return fmt.Sprintf("%s may change %d %s on %s, not %d", class.Name, allowed, noun, occasion, count)
		}
		return ""
	}
	if msg := check(cantripSwaps, changes.Cantrips, "cantrip", "cantrips"); msg != "" {
		return msg, swapResult{}, nil
	}
	if msg := check(preparedSwaps, changes.Prepared, "prepared spell", "prepared spells"); msg != "" {
		return msg, swapResult{}, nil
	}
	// The spell being traded IN answers to the table's codex — the ban that
	// bars a spell at the forge and the seat door bars it at the swap too. This
	// is the one door the level-up swap used to slip through (#239).
	if msg, err := s.codexRefuses(ctx, campaignID, out.In); err != nil {
		return "", swapResult{}, err
	} else if msg != "" {
		return msg, swapResult{}, nil
	}
	return "", out, nil
}

// casterClassesOf reads each class's caster kind and the hero's level in it,
// which is what the combined-level arithmetic runs on (#190). The kind may be
// declared on the class or on its subclass (#220).
func casterClassesOf(classes []heroClass) []rules.CasterClass {
	out := make([]rules.CasterClass, 0, len(classes))
	for _, k := range classes {
		kind, _, isCaster := parseCasting(castingDataOf(k))
		if !isCaster {
			continue
		}
		out = append(out, rules.CasterClass{Kind: kind, Levels: int(k.Level)})
	}
	return out
}

// slotRow turns a nine-length table plus a spent array into the wire shape,
// dropping levels the hero has neither slots in nor spent anything from.
func slotRow(table [9]int, used []int16) []api.SpellSlot {
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
	return slots
}

/*
spellSlotsFor derives the caster block for a Character payload.

Two pools, never added together (PHB 2024, p.44). The shared one comes off the
Multiclass Spellcaster table at the hero's combined caster level; Pact Magic
sits beside it with its own count, its own level, and its own spent counter,
because a spent pact slot must not eat a Wizard's.

`classData` is the starting class, and still supplies the headline casting
ability — the per-class abilities ride on CharacterDetail.casters, since a
Ranger 4 / Sorcerer 3 casts off two of them and one field cannot say so.
*/
func spellSlotsFor(
	classData []byte,
	classes []heroClass,
	level int32,
	used []int16,
	pactUsed int16,
) (ability *string, slots *[]api.SpellSlot, pact *api.SpellSlot) {
	casters := casterClassesOf(classes)
	if len(casters) == 0 {
		// A hero whose class rows have not arrived: fall back to the single
		// class they came in with, which is how this read before #190.
		kind, casting, isCaster := parseCasting(classData)
		if !isCaster {
			return nil, nil, nil
		}
		row := slotRow(rules.SlotTable(kind, int(level)), used)
		a := casting.Ability
		return &a, &row, nil
	}

	row := slotRow(rules.MulticlassSlots(casters), used)

	if n, lv := rules.PactSlotsFor(rules.PactLevels(casters)); n > 0 {
		u := int(pactUsed)
		if u > n {
			u = n
		}
		if u < 0 {
			u = 0
		}
		pact = &api.SpellSlot{Level: lv, Max: n, Used: u}
	}

	// The headline ability: the starting class when it casts, else the first
	// casting class the hero holds — either may cast through its subclass.
	a := ""
	if _, casting, isCaster := parseCasting(classData); isCaster {
		a = casting.Ability
	} else {
		for _, k := range classes {
			if _, casting, ok := parseCasting(castingDataOf(k)); ok {
				a = casting.Ability
				break
			}
		}
	}
	if a == "" && pact == nil && len(row) == 0 {
		return nil, nil, nil
	}
	return &a, &row, pact
}
