package http

import (
	"regexp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
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
	case db.ContentKindSpecies:
		if size, ok := getStr(data, "size"); !ok || strings.TrimSpace(size) == "" {
			return "species data needs a size (e.g. \"Medium\")"
		}
		if speed, ok := getNum(data, "speed"); !ok || speed < 5 || speed > 120 {
			return "species data needs a speed in feet (5-120)"
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
		case "gear":
			// free-form; the summary carries the text
		default:
			return "item type must be armor, weapon, shield or gear"
		}
	case db.ContentKindFeat:
		// Free-form: the summary carries the rules text.
	case db.ContentKindMonster:
		// Free-form: stat blocks vary too much to gate; the Den renders
		// whatever facts are present.
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
