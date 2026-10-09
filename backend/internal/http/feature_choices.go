package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Feature choices: the picks a class feature asks for (#382).

A Fighter's Fighting Style, a Rogue's Expertise, a Cleric's Divine Order — every
class feature that says "of your choice" was prose, so a Fighter at the table
had no Fighting Style anywhere on their sheet and nobody could say where it had
gone. Species solved the same problem with `data.choices`; a class feature now
carries a `choice` of the same shape, and the hero's answers live in
`characters.class_choices`, keyed by the content that asked and the choice's id.

A choice's `type` decides what a pick means:

  - feat: a feat of the category named in `from` (a Fighting Style feat), or
    one of the choice's own `options` (Blessed Warrior). A library feat joins
    `characters.feats`, which is where the sheet lists feats and where the
    armour class and the attack lines read their mechanics.
  - expertise: a skill the hero is proficient in, optionally narrowed by
    `options` (the Wizard's Scholar). It doubles that skill's proficiency.
  - mastery: a kind of weapon, from the item library. Recorded and shown.
  - option: one of `options` (Divine Order). An option may carry `weapons` and
    `armor` it trains — a Protector Cleric swings a longsword proficiently.

How many picks a choice wants can grow with the class: `choose` is a number or
twenty values by class level, or `chooseTable` names a featuresTable column
(Weapon Mastery). Nothing is backfilled: a choice the hero is owed and has not
made is listed with fewer picks than its count, and the sheet asks for it —
which is how the heroes made before this get their Fighting Style.
*/

// The kinds of pick a feature may ask for. Anything else is refused at import
// so a typo never silently becomes a pick that means nothing.
var featureChoiceTypes = map[string]bool{
	"feat":      true,
	"expertise": true,
	"mastery":   true,
	"option":    true,
}

// When a made choice may be changed: never (the default), as the class
// rises (a Fighter's style), or after a rest (Weapon Mastery).
var featureChoiceSwaps = map[string]bool{"": true, "levelup": true, "rest": true}

type featureChoiceOption struct {
	Name    string   `json:"name"`
	Summary string   `json:"summary,omitempty"`
	Weapons []string `json:"weapons,omitempty"`
	Armor   []string `json:"armor,omitempty"`
}

type featureChoiceDecl struct {
	ID          string                `json:"id"`
	Name        string                `json:"name"`
	Type        string                `json:"type"`
	Choose      json.RawMessage       `json:"choose"`
	ChooseTable string                `json:"chooseTable"`
	From        string                `json:"from"`
	Options     []featureChoiceOption `json:"options"`
	Swap        string                `json:"swap"`
}

type choiceFeature struct {
	Level  int                `json:"level"`
	Name   string             `json:"name"`
	Choice *featureChoiceDecl `json:"choice"`
}

type featuresTableColumn struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

type choiceSource struct {
	Features      []choiceFeature       `json:"features"`
	FeaturesTable []featuresTableColumn `json:"featuresTable"`
}

// countAt is how many picks a choice wants at this level in its class. A
// table value that is not a number ("—") counts as none.
func (d featureChoiceDecl) countAt(level int, tables ...[]featuresTableColumn) int {
	at := min(max(level, 1), 20) - 1
	if d.ChooseTable != "" {
		for _, table := range tables {
			for _, col := range table {
				if col.Name == d.ChooseTable && at < len(col.Values) {
					var n int
					if _, err := fmt.Sscanf(strings.TrimSpace(col.Values[at]), "%d", &n); err == nil {
						return n
					}
					return 0
				}
			}
		}
		return 0
	}
	if len(d.Choose) == 0 {
		return 1
	}
	var n int
	if json.Unmarshal(d.Choose, &n) == nil {
		return n
	}
	var byLevel []int
	if json.Unmarshal(d.Choose, &byLevel) == nil && at < len(byLevel) {
		return byLevel[at]
	}
	return 0
}

// choiceKey names one choice on one hero: the content that asked and the id it
// gave the choice, so a Fighter and a Paladin may both call theirs
// "fighting-style" without colliding.
func choiceKey(contentID, choiceID string) string {
	return contentID + ":" + choiceID
}

// featureChoicesFor lists every choice the hero's classes and subclasses have
// asked of them by now, each with the picks already made. Classes are read at
// the level in that class, the way their features are.
func featureChoicesFor(classes []heroClass, stored map[string][]string) []api.FeatureChoice {
	out := []api.FeatureChoice{}
	for _, k := range classes {
		var class choiceSource
		_ = json.Unmarshal(k.ClassData, &class)
		out = append(out, choicesFrom(k.ClassID.String(), k.ClassName, class, nil, int(k.Level), stored)...)
		if k.SubclassID.Valid && len(k.SubclassData) > 0 {
			var sub choiceSource
			if json.Unmarshal(k.SubclassData, &sub) == nil {
				name := k.ClassName
				if k.SubclassName != nil {
					name = *k.SubclassName
				}
				id := uuid.UUID(k.SubclassID.Bytes).String()
				// A subclass may count off its class's table.
				out = append(out, choicesFrom(id, name, sub, class.FeaturesTable, int(k.Level), stored)...)
			}
		}
	}
	return out
}

func choicesFrom(contentID, sourceName string, src choiceSource, parentTable []featuresTableColumn, level int, stored map[string][]string) []api.FeatureChoice {
	var out []api.FeatureChoice
	for _, f := range src.Features {
		at := f.Level
		if at == 0 {
			at = 1
		}
		if f.Choice == nil || at > level {
			continue
		}
		d := *f.Choice
		count := d.countAt(level, src.FeaturesTable, parentTable)
		if count < 1 {
			continue
		}
		key := choiceKey(contentID, d.ID)
		picked := stored[key]
		if picked == nil {
			picked = []string{}
		}
		name := d.Name
		if name == "" {
			name = f.Name
		}
		fc := api.FeatureChoice{
			Key:     key,
			Source:  sourceName,
			Feature: f.Name,
			Name:    name,
			Level:   at,
			Type:    api.FeatureChoiceType(d.Type),
			Count:   count,
			Picked:  picked,
			Options: []api.FeatureChoiceOption{},
		}
		if d.From != "" {
			from := d.From
			fc.From = &from
		}
		if d.Swap != "" {
			swap := api.FeatureChoiceSwap(d.Swap)
			fc.Swap = &swap
		}
		for _, o := range d.Options {
			opt := api.FeatureChoiceOption{Name: o.Name}
			if o.Summary != "" {
				s := o.Summary
				opt.Summary = &s
			}
			if len(o.Weapons) > 0 {
				w := o.Weapons
				opt.Weapons = &w
			}
			if len(o.Armor) > 0 {
				a := o.Armor
				opt.Armor = &a
			}
			fc.Options = append(fc.Options, opt)
		}
		out = append(out, fc)
	}
	return out
}

// expertiseOf gathers the skills every expertise choice has picked.
func expertiseOf(choices []api.FeatureChoice) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, c := range choices {
		if c.Type != api.FeatureChoiceTypeExpertise {
			continue
		}
		for _, p := range c.Picked {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	sort.Strings(out)
	return out
}

func decodeClassChoices(raw []byte) map[string][]string {
	out := map[string][]string{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

// validateFeatureChoices checks the `choice` a class or subclass feature may
// carry, at import, the way species choices are checked.
func validateFeatureChoices(data map[string]interface{}) string {
	raw, ok := data["features"].([]interface{})
	if !ok {
		return ""
	}
	tables := map[string]bool{}
	if cols, ok := data["featuresTable"].([]interface{}); ok {
		for _, c := range cols {
			if col, ok := c.(map[string]interface{}); ok {
				if name, ok := getStr(col, "name"); ok {
					tables[name] = true
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, item := range raw {
		f, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		c, present := f["choice"]
		if !present || c == nil {
			continue
		}
		featureName, _ := getStr(f, "name")
		choice, ok := c.(map[string]interface{})
		if !ok {
			return "the choice on " + featureName + " must be an object"
		}
		id, _ := getStr(choice, "id")
		id = strings.TrimSpace(id)
		if id == "" || len(id) > 40 || strings.Contains(id, ":") {
			return "the choice on " + featureName + " needs an id of 1-40 characters, without a colon"
		}
		if seen[id] {
			return "two features ask the same choice: " + id
		}
		seen[id] = true
		kind, _ := getStr(choice, "type")
		if !featureChoiceTypes[kind] {
			return "the choice on " + featureName + " needs a type of expertise, feat, mastery or option"
		}
		swap, _ := getStr(choice, "swap")
		if !featureChoiceSwaps[swap] {
			return "the choice on " + featureName + " may swap only on levelup or rest"
		}
		table, _ := getStr(choice, "chooseTable")
		if table != "" && !tables[table] && data["class"] == nil {
			return "the choice on " + featureName + " counts off a table column that is not there: " + table
		}
		if n, present := choice["choose"]; present && table == "" {
			switch v := n.(type) {
			case float64:
				if v < 1 || v > 12 {
					return "the choice on " + featureName + " must choose between 1 and 12"
				}
			case []interface{}:
				if len(v) != 20 {
					return "the choice on " + featureName + " counts by level with exactly 20 values"
				}
				for _, x := range v {
					if num, ok := x.(float64); !ok || num < 0 || num > 12 {
						return "the choice on " + featureName + " counts by level in numbers 0-12"
					}
				}
			default:
				return "the choice on " + featureName + " chooses a number, or 20 numbers by level"
			}
		}
		options, msg := parseChoiceOptions(choice, id)
		if msg != "" {
			return msg
		}
		from, _ := getStr(choice, "from")
		switch kind {
		case "option":
			if len(options) < 2 {
				return "the choice on " + featureName + " needs at least two options"
			}
		case "feat":
			if from == "" && len(options) == 0 {
				return "the choice on " + featureName + " needs a feat category in from, or options"
			}
		case "expertise":
			for _, o := range options {
				if !allSkills[o.Name] {
					return "the choice on " + featureName + " lists an unknown skill: " + o.Name
				}
			}
		}
	}
	return ""
}

// SetFeatureChoice records a hero's answer to one class feature's choice.
// An owed choice may be filled whenever the player gets to it — that is how a
// hero forged before choices existed finds their Fighting Style — while a made
// one changes only when its feature says it may (a Fighter's style, Weapon
// Mastery after a rest).
func (s *Server) SetFeatureChoice(ctx context.Context, request api.SetFeatureChoiceRequestObject) (api.SetFeatureChoiceResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetFeatureChoice404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireCharacterEditor(ctx, character); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetFeatureChoice401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetFeatureChoice403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.SetFeatureChoiceResponseObject, error) {
		return api.SetFeatureChoice400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a choice body is required")
	}

	stored := decodeClassChoices(character.ClassChoices)
	slots := featureChoicesFor(s.classesFor(ctx, character), stored)
	var slot *api.FeatureChoice
	for i := range slots {
		if slots[i].Key == request.Body.Key {
			slot = &slots[i]
		}
	}
	if slot == nil {
		return badRequest(character.Name + " has no choice to make called " + request.Body.Key)
	}

	// A pick may appear twice only when it is a feat that says it may be taken
	// more than once (Agonizing Blast, one cantrip at a time) — checked with
	// the feat below; every other kind of pick is made once.
	picks := make([]string, 0, len(request.Body.Picks))
	twice := map[string]bool{}
	seen := map[string]bool{}
	for _, p := range request.Body.Picks {
		p = strings.TrimSpace(p)
		if p == "" {
			return badRequest(slot.Name + " needs a choice")
		}
		if seen[strings.ToLower(p)] {
			if slot.Type != api.FeatureChoiceTypeFeat {
				return badRequest(slot.Name + ": " + p + " is chosen twice")
			}
			twice[strings.ToLower(p)] = true
		}
		seen[strings.ToLower(p)] = true
		picks = append(picks, p)
	}
	if len(picks) != slot.Count {
		return badRequest(fmt.Sprintf("%s: choose %d", slot.Name, slot.Count))
	}
	kept := map[string]bool{}
	for _, p := range picks {
		kept[p] = true
	}
	for _, old := range slot.Picked {
		if !kept[old] && slot.Swap == nil {
			return badRequest(slot.Name + " is already chosen, and " + slot.Feature + " does not let it change")
		}
	}

	options := map[string]bool{}
	for _, o := range slot.Options {
		options[o.Name] = true
	}
	var featIDs []uuid.UUID
	var featPicks []string
	switch slot.Type {
	case api.FeatureChoiceTypeOption:
		for _, p := range picks {
			if !options[p] {
				return badRequest(p + " is not an option for " + slot.Name)
			}
		}

	case api.FeatureChoiceTypeExpertise:
		proficient := map[string]bool{}
		for _, sk := range character.Skills {
			proficient[sk] = true
		}
		elsewhere := map[string]bool{}
		for _, other := range slots {
			if other.Key != slot.Key && other.Type == api.FeatureChoiceTypeExpertise {
				for _, p := range other.Picked {
					elsewhere[p] = true
				}
			}
		}
		for _, p := range picks {
			if len(options) > 0 && !options[p] {
				return badRequest(p + " is not an option for " + slot.Name)
			}
			if !proficient[p] {
				return badRequest("Expertise needs a skill " + character.Name + " is proficient in — " + p + " is not one")
			}
			if elsewhere[p] {
				return badRequest(character.Name + " already has Expertise in " + p)
			}
		}

	case api.FeatureChoiceTypeMastery:
		weapons, err := s.libraryByName(ctx, character, db.ContentKindItem)
		if err != nil {
			return nil, err
		}
		for i, p := range picks {
			row, ok := weapons[strings.ToLower(p)]
			if !ok || !isWeaponKind(row.Data) {
				return badRequest(p + " is not a kind of weapon in the library")
			}
			picks[i] = row.Name
		}

	case api.FeatureChoiceTypeFeat:
		feats, err := s.libraryByName(ctx, character, db.ContentKindFeat)
		if err != nil {
			return nil, err
		}
		from := ""
		if slot.From != nil {
			from = *slot.From
		}
		var otherPicks []string
		for _, other := range slots {
			if other.Key != slot.Key && other.Type == api.FeatureChoiceTypeFeat {
				otherPicks = append(otherPicks, other.Picked...)
			}
		}
		held := map[string]int{}
		for _, f := range character.Feats {
			held[strings.ToLower(f)]++
		}
		for _, old := range slot.Picked {
			held[strings.ToLower(old)]--
		}

		// The levels a prerequisite is read against, and what counts as held:
		// the hero's feats, or a pick made in this same answer.
		levels := map[string]int{}
		for _, k := range s.classesFor(ctx, character) {
			levels[strings.ToLower(k.ClassName)] = int(k.Level)
		}
		has := func(name string) bool {
			name = strings.ToLower(name)
			if held[name] > 0 || seen[name] {
				return true
			}
			return false
		}

		repeatable := map[string]bool{}
		var libraryPicks []string
		for i, p := range picks {
			if options[p] {
				continue // a feature's own alternative, like Blessed Warrior
			}
			key := strings.ToLower(p)
			row, ok := feats[key]
			if !ok || from == "" || !strings.EqualFold(featCategory(row.Data), from) {
				return badRequest(p + " is not a choice for " + slot.Name)
			}
			if twice[key] && !featRepeatable(row.Data) {
				return badRequest(slot.Name + ": " + row.Name + " is chosen twice")
			}
			if why := parseFeatPrereq(featPrerequisite(row.Data)).unmet(levels, int(character.Level), has); why != "" {
				return badRequest(row.Name + " " + why)
			}
			picks[i] = row.Name
			featIDs = append(featIDs, row.ID)
			if featRepeatable(row.Data) {
				repeatable[key] = true
			}
			libraryPicks = append(libraryPicks, row.Name)
		}
		appended, refused := placeFeatPicks(character.Feats, slot.Picked, otherPicks, libraryPicks, repeatable)
		if refused != "" {
			return badRequest(character.Name + " already has " + refused)
		}
		featPicks = appended
	}

	// A seated hero's feat answers to the table's codex, as at level-up.
	if campaignID, seated := seatedCampaign(character); seated && len(featIDs) > 0 {
		blockers, err := s.codexBlockers(ctx, campaignID, featIDs)
		if err != nil {
			return nil, err
		}
		if len(blockers) > 0 {
			return badRequest(blockers[0].row.Name + " is not admitted by the campaign's codex — ask the DM")
		}
	}

	// Feats move with the choice: the old picks leave, the new ones arrive.
	// Feats move with the choice: the old picks leave, the new ones arrive.
	feats := nextFeats(character.Feats, slot.Picked, featPicks)

	stored[slot.Key] = picks
	raw, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	updated, err := s.queries.SetClassChoices(ctx, db.SetClassChoicesParams{
		ID:           character.ID,
		ClassChoices: raw,
		Feats:        feats,
	})
	if err != nil {
		return nil, err
	}
	ownerName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out := toAPICharacterWithClass(updated, ownerName, uid, s.classDataFor(ctx, updated), s.classesFor(ctx, updated))
	attachPools(&out, s.resolvePools(ctx, updated))
	return api.SetFeatureChoice200JSONResponse(out), nil
}

// libraryByName is the content of one kind the hero's owner may draw on, by
// lowercased name — SRD, their homebrew, and homebrew their tables admit.
func (s *Server) libraryByName(ctx context.Context, c db.Character, kind db.ContentKind) (map[string]db.ListContentByKindRow, error) {
	rows, err := s.queries.ListContentByKind(ctx, db.ListContentByKindParams{
		Kind:      kind,
		CreatedBy: pgUUID(c.OwnerUserID),
	})
	if err != nil {
		return nil, err
	}
	out := map[string]db.ListContentByKindRow{}
	for _, r := range rows {
		key := strings.ToLower(r.Name)
		// SRD first: a homebrew shadow never displaces the book's own entry.
		if _, taken := out[key]; taken && r.Source != db.ContentSourceSrd {
			continue
		}
		out[key] = r
	}
	return out, nil
}

// grantsFeatCategory is whether any feature the hero has reached asks for a
// feat of this category — the Fighting Style feature a Fighting Style feat
// names as its prerequisite.
func grantsFeatCategory(classes []heroClass, category string) bool {
	for _, c := range featureChoicesFor(classes, nil) {
		if c.Type == api.FeatureChoiceTypeFeat && c.From != nil && strings.EqualFold(*c.From, category) {
			return true
		}
	}
	return false
}

func featPrerequisite(data []byte) string {
	var d struct {
		Prerequisite string `json:"prerequisite"`
	}
	_ = json.Unmarshal(data, &d)
	return d.Prerequisite
}

func featRepeatable(data []byte) bool {
	var d struct {
		Repeatable bool `json:"repeatable"`
	}
	_ = json.Unmarshal(data, &d)
	return d.Repeatable
}

func featCategory(data []byte) string {
	var d struct {
		Category string `json:"category"`
	}
	_ = json.Unmarshal(data, &d)
	return d.Category
}

// isWeaponKind is a weapon as the armory sells it, not a magic one: Weapon
// Mastery names a kind of weapon, and a +1 Longsword is still a Longsword.
func isWeaponKind(data []byte) bool {
	var d struct {
		Type   string `json:"type"`
		Rarity string `json:"rarity"`
	}
	_ = json.Unmarshal(data, &d)
	return d.Type == "weapon" && d.Rarity == ""
}

/*
placeFeatPicks decides, for a feat choice's new answer, which picks join the
hero's feats (#384). Everything is counted, because a repeatable invocation sits
on the sheet twice.

What the hero holds outside this choice splits in two. A feat another choice
picked is taken — refused, unless it is repeatable. A feat no choice picked — an
invocation a Warlock took at an Ability Score Improvement before their feature
asked — is adopted: this choice claims the copy already on the sheet instead of
refusing it as held or adding a second one. Anything else is appended.

It answers the names to append, or the name refused.
*/
func placeFeatPicks(heroFeats, oldPicks, otherPicks, picks []string, repeatable map[string]bool) ([]string, string) {
	held := map[string]int{}
	for _, f := range heroFeats {
		held[strings.ToLower(f)]++
	}
	for _, old := range oldPicks {
		held[strings.ToLower(old)]--
	}
	claimed := map[string]int{}
	for _, p := range otherPicks {
		claimed[strings.ToLower(p)]++
	}
	var appended []string
	for _, p := range picks {
		key := strings.ToLower(p)
		if held[key]-claimed[key] > 0 {
			held[key]-- // an orphan on the sheet: this choice claims it
			continue
		}
		if claimed[key] > 0 && !repeatable[key] {
			return nil, p
		}
		appended = append(appended, p)
	}
	return appended, ""
}

// nextFeats is the hero's feats once a choice's old picks leave and its new
// ones arrive — one copy per pick, since a repeatable one may sit twice.
// Adopted picks were never appended and were never removed, so they stay.
func nextFeats(heroFeats, oldPicks, appended []string) []string {
	out := []string{}
	dropped := map[string]int{}
	for _, old := range oldPicks {
		dropped[strings.ToLower(old)]++
	}
	for _, f := range heroFeats {
		if dropped[strings.ToLower(f)] > 0 {
			dropped[strings.ToLower(f)]--
			continue
		}
		out = append(out, f)
	}
	return append(out, appended...)
}
