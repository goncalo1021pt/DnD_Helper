package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// The six ability shorthands, for validating saves and background bonuses.
var abilityNames = map[string]bool{
	"STR": true, "DEX": true, "CON": true, "INT": true, "WIS": true, "CHA": true,
}

var weaponDamageRe = regexp.MustCompile(`^(\d+|\d+d\d+([+-]\d+)?)$`)

func getStr(data map[string]interface{}, key string) (string, bool) {
	v, ok := data[key].(string)
	return v, ok
}

func getNum(data map[string]interface{}, key string) (float64, bool) {
	v, ok := data[key].(float64)
	return v, ok
}

func getStrSlice(data map[string]interface{}, key string) ([]string, bool) {
	raw, ok := data[key].([]interface{})
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		s, ok := item.(string)
		if !ok {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

// validateContentData checks the structural pieces the engine relies on for
// each kind. Extra keys are welcome — homebrew is allowed to carry more.
func validateContentData(kind db.ContentKind, data map[string]interface{}) string {
	switch kind {
	case db.ContentKindClass:
		hd, ok := getNum(data, "hitDie")
		if !ok || (hd != 6 && hd != 8 && hd != 10 && hd != 12) {
			return "class data needs hitDie of 6, 8, 10 or 12"
		}
		saves, ok := getStrSlice(data, "saves")
		if !ok || len(saves) != 2 || !abilityNames[saves[0]] || !abilityNames[saves[1]] || saves[0] == saves[1] {
			return "class data needs saves: two distinct abilities (e.g. [\"STR\",\"CON\"])"
		}
		sc, ok := data["skillChoices"].(map[string]interface{})
		if !ok {
			return "class data needs skillChoices {choose, from}"
		}
		choose, ok := getNum(sc, "choose")
		if !ok || choose < 1 || choose > 6 {
			return "skillChoices.choose must be between 1 and 6"
		}
		from, ok := getStrSlice(sc, "from")
		if !ok || len(from) == 0 {
			return "skillChoices.from must list skills (or [\"*\"] for any)"
		}
		if !(len(from) == 1 && from[0] == "*") {
			for _, sk := range from {
				if !allSkills[sk] {
					return "unknown skill in skillChoices.from: " + sk
				}
			}
		}
		if msg := validateFeaturesTable(data); msg != "" {
			return msg
		}
	case db.ContentKindSpecies:
		if size, ok := getStr(data, "size"); !ok || strings.TrimSpace(size) == "" {
			return "species data needs a size (e.g. \"Medium\")"
		}
		if speed, ok := getNum(data, "speed"); !ok || speed < 5 || speed > 120 {
			return "species data needs a speed in feet (5-120)"
		}
		if msg := validateSpeciesChoices(data); msg != "" {
			return msg
		}
	case db.ContentKindBackground:
		abilities, ok := getStrSlice(data, "abilityScores")
		if !ok || len(abilities) != 3 {
			return "background data needs abilityScores: exactly three abilities"
		}
		seen := map[string]bool{}
		for _, ab := range abilities {
			if !abilityNames[ab] || seen[ab] {
				return "abilityScores must be three distinct abilities (e.g. [\"STR\",\"DEX\",\"CON\"])"
			}
			seen[ab] = true
		}
		skills, ok := getStrSlice(data, "skills")
		if !ok || len(skills) != 2 || skills[0] == skills[1] || !allSkills[skills[0]] || !allSkills[skills[1]] {
			return "background data needs skills: two distinct skills"
		}
		if feat, ok := getStr(data, "feat"); !ok || strings.TrimSpace(feat) == "" {
			return "background data needs its origin feat name"
		}
	case db.ContentKindSubclass:
		if class, ok := getStr(data, "class"); !ok || strings.TrimSpace(class) == "" {
			return "subclass data needs class: the parent class name (e.g. \"Fighter\")"
		}
	case db.ContentKindSpell:
		lvl, ok := getNum(data, "level")
		if !ok || lvl < 0 || lvl > 9 {
			return "a spell needs a level between 0 (cantrip) and 9"
		}
		if school, _ := getStr(data, "school"); school == "" {
			return "a spell needs a school of magic"
		}
		classes, _ := getStrSlice(data, "classes")
		if len(classes) == 0 {
			return "a spell needs at least one class that can learn it"
		}
	case db.ContentKindItem:
		itemType, _ := getStr(data, "type")
		switch itemType {
		case "armor":
			cat, _ := getStr(data, "category")
			if cat != "Light" && cat != "Medium" && cat != "Heavy" {
				return "armor category must be Light, Medium or Heavy"
			}
			if ac, ok := getNum(data, "ac"); !ok || ac < 10 || ac > 20 {
				return "armor needs a base AC between 10 and 20"
			}
		case "shield":
			if bonus, ok := getNum(data, "acBonus"); !ok || bonus < 1 || bonus > 3 {
				return "a shield needs an AC bonus between 1 and 3"
			}
		case "weapon":
			if cat, _ := getStr(data, "category"); cat != "Simple" && cat != "Martial" {
				return "weapon category must be Simple or Martial"
			}
			dmg, _ := getStr(data, "damage")
			if !weaponDamageRe.MatchString(dmg) {
				return "weapon damage must look like 1d8 or 2d6+1 (or a flat number)"
			}
			if dt, _ := getStr(data, "damageType"); dt == "" {
				return "a weapon needs a damage type"
			}
			// The Versatile two-handed die, when the weapon has one (#189).
			if d2, ok := getStr(data, "damage2"); ok && d2 != "" && !weaponDamageRe.MatchString(d2) {
				return "damage2 must look like 1d10 (the two-handed die)"
			}
		case "gear":
			// free-form; the summary carries the text
		default:
			return "item type must be armor, weapon, shield or gear"
		}
		// The fields every item may carry, whatever it does in a fight (#101).
		if msg := validateItemTrappings(data); msg != "" {
			return msg
		}
		// And the magic on top (#189): a worn kind, a +N bonus.
		if msg := validateMagicItem(data); msg != "" {
			return msg
		}
	case db.ContentKindFeat:
		// Free-form: the summary carries the rules text.
	case db.ContentKindMonster:
		// Free-form: stat blocks vary too much to gate; the Den renders
		// whatever facts are present.
	case db.ContentKindRule:
		// Free-form: a keyword's rules text lives in the description, and a
		// pack's subsystem (Circle Magic, Renown) is prose too. `category` is
		// uncurated on purpose — the codex groups by whatever is there.
	}
	// Creature grants and scaling ride on every kind, so they are checked
	// after the switch rather than repeated inside five of its arms.
	if msg := validateCreatureDeclarations(data); msg != "" {
		return msg
	}
	// Resource pools too: a feat or an item may grant one as readily as a class.
	if msg := validatePools(data); msg != "" {
		return msg
	}
	return ""
}

/*
Resource pools, as content declares them (#175).

A pool's maximum is either a scale expression over the hero or a table of
exactly twenty values, one per level — Rages follow no formula, Focus Points
are just the level. Like `scale`, a bad declaration is refused at import
rather than at the table: the alternative is a Barbarian who reads zero Rages
mid-session with nothing anywhere saying why.
*/
func validatePools(data map[string]interface{}) string {
	raw, present := data["pools"]
	if !present {
		return ""
	}
	list, ok := raw.([]interface{})
	if !ok {
		return "pools must be a list of {name, uses}"
	}
	seen := map[string]bool{}
	for _, entry := range list {
		pool, ok := entry.(map[string]interface{})
		if !ok {
			return "each pool must be an object with a name and uses"
		}
		name, ok := getStr(pool, "name")
		if !ok || strings.TrimSpace(name) == "" {
			return "each pool needs a name"
		}
		if seen[name] {
			return "pools declares " + name + " twice"
		}
		seen[name] = true
		switch uses := pool["uses"].(type) {
		case string:
			if err := rules.Check(uses); err != nil {
				return "pool " + name + " uses: " + err.Error()
			}
		case []interface{}:
			if len(uses) != 20 {
				return "pool " + name + " needs one uses value per level — exactly 20"
			}
			for _, v := range uses {
				n, ok := v.(float64)
				if !ok || n < 0 || n != math.Trunc(n) {
					return "pool " + name + " uses must be whole numbers, 0 or more"
				}
			}
		default:
			return "pool " + name + " needs uses: an expression or a table of 20 numbers"
		}
		if lvl, present := pool["level"]; present {
			if n, ok := lvl.(float64); !ok || n < 1 || n > 20 {
				return "pool " + name + " level must be between 1 and 20"
			}
		}
		if sr, ok := getStr(pool, "shortRest"); ok && sr != "" &&
			sr != rules.ShortRestNone && sr != rules.ShortRestOne && sr != rules.ShortRestAll {
			return "pool " + name + " shortRest must be none, one or all"
		}
		if lvl, present := pool["shortRestLevel"]; present {
			if n, ok := lvl.(float64); !ok || n < 1 || n > 20 {
				return "pool " + name + " shortRestLevel must be between 1 and 20"
			}
		}
	}
	return ""
}

/*
The second stat block, as content declares it (#180-adjacent, and the whole of
what makes an Artificer possible without shipping one).

Three shapes are checked here, on any kind that carries them:

  - `companions`, on a class/subclass/feat/species/item: creatures the feature
    hands the hero, named the same way a subclass names its class.
  - `forms`, on the same: a shapeshifter's allowance table.
  - `scale`, on a monster: expressions evaluated against the hero who owns the
    creature, so a companion's hit points follow their level instead of going
    stale the moment they gain one.

A bad expression is refused at import rather than at the table. The alternative
is a companion that quietly reads zero hit points three sessions later, with
nothing anywhere saying why.
*/
func validateCreatureDeclarations(data map[string]interface{}) string {
	if raw, present := data["companions"]; present {
		list, ok := raw.([]interface{})
		if !ok {
			return "companions must be a list of {name, role}"
		}
		for _, entry := range list {
			grant, ok := entry.(map[string]interface{})
			if !ok {
				return "each companion must be an object with a name"
			}
			if name, ok := getStr(grant, "name"); !ok || strings.TrimSpace(name) == "" {
				return "each companion needs the name of the stat block it grants"
			}
			if role, ok := getStr(grant, "role"); ok && role != "" &&
				role != "form" && role != "companion" && role != "summon" {
				return "companion role must be form, companion or summon"
			}
		}
	}

	if raw, present := data["forms"]; present {
		forms, ok := raw.(map[string]interface{})
		if !ok {
			return "forms must be an object with a table"
		}
		if temp, ok := getStr(forms, "tempHp"); ok && strings.TrimSpace(temp) != "" {
			if err := rules.Check(temp); err != nil {
				return "forms.tempHp: " + err.Error()
			}
		}
		table, ok := forms["table"].([]interface{})
		if !ok || len(table) == 0 {
			return "forms needs a table of {level, known, maxCR, fly} rows"
		}
		for _, entry := range table {
			row, ok := entry.(map[string]interface{})
			if !ok {
				return "each forms.table row must be an object"
			}
			if level, ok := getNum(row, "level"); !ok || level < 1 || level > 20 {
				return "each forms.table row needs a level between 1 and 20"
			}
			if known, ok := getNum(row, "known"); !ok || known < 1 {
				return "each forms.table row needs how many forms are known"
			}
			if _, ok := getNum(row, "maxCR"); !ok {
				return "each forms.table row needs a maxCR ceiling"
			}
		}
	}

	if raw, present := data["scale"]; present {
		scale, ok := raw.(map[string]interface{})
		if !ok {
			return "scale must be an object of field name to expression"
		}
		for field, expr := range scale {
			text, ok := expr.(string)
			if !ok {
				return "scale." + field + " must be an expression, e.g. \"5 * level + con\""
			}
			if err := rules.Check(text); err != nil {
				return "scale." + field + ": " + err.Error()
			}
		}
	}
	return ""
}

/*
What an item is worth, weighs, and how rare it is (#101).

These sit outside the type switch because they are true of a rope and of a
Vorpal Sword alike: an item's cost, weight, rarity and attunement have nothing
to do with whether it is worn, swung or drunk. Rarity is what makes an item
magical here — there is no separate "magic" type, because a magic sword is still
a sword and everything that reads a weapon should keep reading it as one.

Blank is always allowed. Most gear has no rarity, plenty of homebrew has no
priced cost, and refusing an item for lacking a field it does not need is how a
form stops being used.
*/
var itemRarities = map[string]bool{
	"": true, "common": true, "uncommon": true, "rare": true,
	"very rare": true, "legendary": true, "artifact": true,
}

// costRe accepts the way the books write a price — "15 gp", "1 sp", "5,000 gp"
// — and nothing else, so a cost cannot quietly become prose the sheet then
// prints as a number.
var costRe = regexp.MustCompile(`^\d{1,3}(,\d{3})*(\.\d+)?\s?(cp|sp|ep|gp|pp)$`)

/*
The magic on an item (#189): where it is worn, and what its +N is worth.

`wear` makes a gear item occupy a place on the body — a cloak, a ring — so a
Cloak of Protection takes a slot the way armor does instead of lying in the
pack as prose. `bonus` is the +1..+3 the engines actually apply: to AC on
armor, shields and worn items, to attack and damage on weapons. Both engines
read it (armor.go here, derive.ts in the client), so both are validated at
the door like everything the sheet computes from.
*/
func validateMagicItem(data map[string]interface{}) string {
	itemType, _ := getStr(data, "type")
	if wear, ok := getStr(data, "wear"); ok && wear != "" {
		if itemType != "gear" {
			return "wear belongs on gear — armor, shields and weapons have their own slots"
		}
		if _, known := wearSlots[wear]; !known {
			return "wear must be cloak, amulet, helm, belt, boots, gloves, bracers or ring"
		}
	}
	if raw, present := data["bonus"]; present {
		n, ok := raw.(float64)
		if !ok || n < 1 || n > 3 || n != math.Trunc(n) {
			return "a magic bonus is +1, +2 or +3"
		}
		wear, _ := getStr(data, "wear")
		if itemType == "gear" && wear == "" {
			return "a bonus needs somewhere to apply — armor, a shield, a weapon, or a worn item"
		}
		if rarity, _ := getStr(data, "rarity"); strings.TrimSpace(rarity) == "" {
			return "only a magic item can carry a bonus — give it a rarity"
		}
	}
	return ""
}

func validateItemTrappings(data map[string]interface{}) string {
	if rarity, _ := getStr(data, "rarity"); !itemRarities[strings.ToLower(strings.TrimSpace(rarity))] {
		return "rarity must be common, uncommon, rare, very rare, legendary or artifact"
	}
	if cost, _ := getStr(data, "cost"); strings.TrimSpace(cost) != "" &&
		!costRe.MatchString(strings.ToLower(strings.TrimSpace(cost))) {
		return "cost must read like 15 gp, 1 sp or 5,000 gp"
	}
	if w, ok := getNum(data, "weight"); ok && (w < 0 || w > 10000) {
		return "weight must be between 0 and 10000 lb"
	}
	// Attunement without a rarity is a mundane item asking to be attuned to,
	// which no rule allows and which reads on the sheet as a magic item that
	// forgot to say so.
	if att, ok := data["attunement"].(bool); ok && att {
		if rarity, _ := getStr(data, "rarity"); strings.TrimSpace(rarity) == "" {
			return "only a magic item can require attunement — give it a rarity"
		}
	}
	return ""
}

func toAPIRulesContent(row db.RulesContent, creatorName *string, viewer uuid.UUID) api.RulesContent {
	var data map[string]interface{}
	if err := json.Unmarshal(row.Data, &data); err != nil {
		data = map[string]interface{}{}
	}
	mine := row.CreatedBy.Valid && uuid.UUID(row.CreatedBy.Bytes) == viewer
	return api.RulesContent{
		Id:          row.ID,
		Kind:        api.RulesContentKind(string(row.Kind)),
		Source:      api.RulesContentSource(string(row.Source)),
		Name:        row.Name,
		Summary:     row.Summary,
		Data:        data,
		Mine:        mine,
		CreatorName: creatorName,
	}
}

// validateContentInput normalizes the shared create/update body.
func validateContentInput(kind db.ContentKind, body *api.RulesContentInput) (name, summary string, data []byte, errMsg string) {
	if body == nil {
		return "", "", nil, "a content body is required"
	}
	name = strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > 80 {
		return "", "", nil, "name must be between 1 and 80 characters"
	}
	summary = strings.TrimSpace(body.Summary)
	if len([]rune(summary)) > 300 {
		return "", "", nil, "summary must be at most 300 characters"
	}
	if msg := validateContentData(kind, body.Data); msg != "" {
		return "", "", nil, msg
	}
	raw, err := json.Marshal(body.Data)
	if err != nil {
		return "", "", nil, "data must be a JSON object"
	}
	return name, summary, raw, ""
}

// CreateRulesContent adds a homebrew entry — any signed-in user may scribe.
func (s *Server) CreateRulesContent(ctx context.Context, request api.CreateRulesContentRequestObject) (api.CreateRulesContentResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.CreateRulesContent401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	kind := db.ContentKind(string(request.Kind))
	name, summary, data, errMsg := validateContentInput(kind, request.Body)
	if errMsg != "" {
		return api.CreateRulesContent400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}

	row, err := s.queries.CreateHomebrew(ctx, db.CreateHomebrewParams{
		Kind:      kind,
		Name:      name,
		Summary:   summary,
		Data:      data,
		CreatedBy: pgUUID(uid),
	})
	if err != nil {
		if isUniqueViolation(err) {
			return api.CreateRulesContent400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: fmt.Sprintf("you already have a homebrew %s named %q", kind, name),
			}}, nil
		}
		return nil, err
	}
	me, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.CreateRulesContent201JSONResponse(toAPIRulesContent(row, &me.Name, uid)), nil
}

// requireContentAuthor loads an entry and enforces homebrew + authorship.
func (s *Server) requireContentAuthor(ctx context.Context, id, uid uuid.UUID) (db.RulesContent, error) {
	row, err := s.queries.GetContent(ctx, id)
	if err != nil {
		return db.RulesContent{}, err
	}
	if row.Source != db.ContentSourceHomebrew {
		return row, fmt.Errorf("%w: the SRD is carved in stone", errForbidden)
	}
	if !row.CreatedBy.Valid || uuid.UUID(row.CreatedBy.Bytes) != uid {
		return row, errForbidden
	}
	return row, nil
}

// UpdateRulesContent edits a homebrew entry (author only).
func (s *Server) UpdateRulesContent(ctx context.Context, request api.UpdateRulesContentRequestObject) (api.UpdateRulesContentResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.UpdateRulesContent401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	existing, err := s.requireContentAuthor(ctx, request.ContentId, uid)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.UpdateRulesContent404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateRulesContent403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	name, summary, data, errMsg := validateContentInput(existing.Kind, request.Body)
	if errMsg != "" {
		return api.UpdateRulesContent400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	row, err := s.queries.UpdateContent(ctx, db.UpdateContentParams{
		ID:      existing.ID,
		Name:    name,
		Summary: summary,
		Data:    data,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return api.UpdateRulesContent400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: fmt.Sprintf("you already have a homebrew %s named %q", existing.Kind, name),
			}}, nil
		}
		return nil, err
	}
	me, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.UpdateRulesContent200JSONResponse(toAPIRulesContent(row, &me.Name, uid)), nil
}

// DeleteRulesContent removes a homebrew entry (author only). Characters that
// referenced it keep their sheets — the reference nulls out.
func (s *Server) DeleteRulesContent(ctx context.Context, request api.DeleteRulesContentRequestObject) (api.DeleteRulesContentResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.DeleteRulesContent401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	existing, err := s.requireContentAuthor(ctx, request.ContentId, uid)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.DeleteRulesContent404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteRulesContent403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteContent(ctx, existing.ID); err != nil {
		return nil, err
	}
	return api.DeleteRulesContent204Response{}, nil
}

// GetHomebrewImpact previews a homebrew reset: per-kind counts and how much of
// it is in use, so the caller sees the blast radius before wiping.
func (s *Server) GetHomebrewImpact(ctx context.Context, _ api.GetHomebrewImpactRequestObject) (api.GetHomebrewImpactResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.GetHomebrewImpact401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.HomebrewImpact(ctx, pgUUID(uid))
	if err != nil {
		return nil, err
	}
	var out api.HomebrewImpact
	for _, r := range rows {
		out.ByKind = append(out.ByKind, struct {
			InCampaigns        int    `json:"inCampaigns"`
			Kind               string `json:"kind"`
			OnMyCharacters     int    `json:"onMyCharacters"`
			OnOthersCharacters int    `json:"onOthersCharacters"`
			Total              int    `json:"total"`
		}{
			InCampaigns:        int(r.InCampaigns),
			Kind:               string(r.Kind),
			OnMyCharacters:     int(r.OnMyCharacters),
			OnOthersCharacters: int(r.OnOthersCharacters),
			Total:              int(r.Total),
		})
	}
	return api.GetHomebrewImpact200JSONResponse(out), nil
}

// GetHomebrewBooks lists the caller's homebrew grouped by source book — the
// imported-packs shelf on the profile. A nil book means hand-scribed.
func (s *Server) GetHomebrewBooks(ctx context.Context, _ api.GetHomebrewBooksRequestObject) (api.GetHomebrewBooksResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.GetHomebrewBooks401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.HomebrewBooks(ctx, pgUUID(uid))
	if err != nil {
		return nil, err
	}
	out := api.HomebrewBooks{Rows: []struct {
		Book  *string `json:"book,omitempty"`
		Kind  string  `json:"kind"`
		Total int     `json:"total"`
	}{}}
	for _, r := range rows {
		var book *string
		if r.Book != "" {
			b := r.Book
			book = &b
		}
		out.Rows = append(out.Rows, struct {
			Book  *string `json:"book,omitempty"`
			Kind  string  `json:"kind"`
			Total int     `json:"total"`
		}{Book: book, Kind: string(r.Kind), Total: int(r.Total)})
	}
	return api.GetHomebrewBooks200JSONResponse(out), nil
}

// ResetHomebrew deletes the caller's homebrew — every kind, one kind, or one
// imported book. FK cascades degrade the sheets that referenced it rather
// than break them.
func (s *Server) ResetHomebrew(ctx context.Context, request api.ResetHomebrewRequestObject) (api.ResetHomebrewResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ResetHomebrew401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if request.Params.Kind != nil && request.Params.Book != nil {
		return api.ResetHomebrew400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "kind and book are mutually exclusive"}}, nil
	}
	var deleted int64
	var err error
	if request.Params.Book != nil {
		if *request.Params.Book == "" {
			return api.ResetHomebrew400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "book must not be empty"}}, nil
		}
		deleted, err = s.queries.DeleteOwnHomebrewByBook(ctx, db.DeleteOwnHomebrewByBookParams{
			CreatedBy: pgUUID(uid),
			Book:      *request.Params.Book,
		})
	} else if request.Params.Kind != nil {
		kind := db.ContentKind(*request.Params.Kind)
		if !validContentKind(kind) {
			return api.ResetHomebrew400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "unknown content kind"}}, nil
		}
		deleted, err = s.queries.DeleteOwnHomebrewByKind(ctx, db.DeleteOwnHomebrewByKindParams{
			CreatedBy: pgUUID(uid),
			Kind:      kind,
		})
	} else {
		deleted, err = s.queries.DeleteOwnHomebrew(ctx, pgUUID(uid))
	}
	if err != nil {
		return nil, err
	}
	return api.ResetHomebrew200JSONResponse{Deleted: int(deleted)}, nil
}

// validContentKind guards the free-string kind on the reset endpoint.
func validContentKind(k db.ContentKind) bool {
	switch k {
	case db.ContentKindClass, db.ContentKindSpecies, db.ContentKindBackground,
		db.ContentKindSubclass, db.ContentKindFeat, db.ContentKindSpell,
		db.ContentKindItem, db.ContentKindMonster, db.ContentKindRule:
		return true
	}
	return false
}
