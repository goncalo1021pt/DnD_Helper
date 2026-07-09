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
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// The eighteen skills of the 2024 rules, for validating wildcard choices.
var allSkills = map[string]bool{
	"Acrobatics": true, "Animal Handling": true, "Arcana": true, "Athletics": true,
	"Deception": true, "History": true, "Insight": true, "Intimidation": true,
	"Investigation": true, "Medicine": true, "Nature": true, "Perception": true,
	"Performance": true, "Persuasion": true, "Religion": true, "Sleight of Hand": true,
	"Stealth": true, "Survival": true,
}

// The class-data slice the forge needs.
type classRules struct {
	HitDie       int `json:"hitDie"`
	SkillChoices struct {
		Choose int      `json:"choose"`
		From   []string `json:"from"`
	} `json:"skillChoices"`
}

type backgroundRules struct {
	Skills []string `json:"skills"`
}

func abilityMod(score int) int {
	d := score - 10
	if d < 0 {
		d -= 1 // floor division for negatives
	}
	return d / 2
}

// fetchContent loads a rules entry and enforces its kind.
func (s *Server) fetchContent(ctx context.Context, id uuid.UUID, kind db.ContentKind) (db.RulesContent, error) {
	row, err := s.queries.GetContent(ctx, id)
	if err != nil {
		return db.RulesContent{}, err
	}
	if row.Kind != kind {
		return db.RulesContent{}, fmt.Errorf("content %s is not a %s", id, kind)
	}
	return row, nil
}

// ForgeCharacter builds a level-1 hero through the wizard: validated against
// the rules content, HP derived from the class hit die and CON modifier.
func (s *Server) ForgeCharacter(ctx context.Context, request api.ForgeCharacterRequestObject) (api.ForgeCharacterResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ForgeCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	badRequest := func(msg string) (api.ForgeCharacterResponseObject, error) {
		return api.ForgeCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a forge body is required")
	}
	body := request.Body

	name := strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > 80 {
		return badRequest("name must be between 1 and 80 characters")
	}

	// The three pillars must exist and be of the right kind.
	class, err := s.fetchContent(ctx, uuid.UUID(body.ClassId), db.ContentKindClass)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return badRequest("unknown class")
		}
		return badRequest("that choice is not a class")
	}
	species, err := s.fetchContent(ctx, uuid.UUID(body.SpeciesId), db.ContentKindSpecies)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return badRequest("unknown species")
		}
		return badRequest("that choice is not a species")
	}
	background, err := s.fetchContent(ctx, uuid.UUID(body.BackgroundId), db.ContentKindBackground)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return badRequest("unknown background")
		}
		return badRequest("that choice is not a background")
	}

	// Ability scores: creation range after background bonuses.
	scores := map[string]int{
		"STR": body.Abilities.Str, "DEX": body.Abilities.Dex, "CON": body.Abilities.Con,
		"INT": body.Abilities.Int, "WIS": body.Abilities.Wis, "CHA": body.Abilities.Cha,
	}
	for ab, v := range scores {
		if v < 3 || v > 20 {
			return badRequest(fmt.Sprintf("%s must be between 3 and 20 at creation", ab))
		}
	}

	// Skill choices: exactly the class's count, from its list (or any skill
	// for wildcard classes), never duplicating the background's fixed skills.
	var cr classRules
	if err := json.Unmarshal(class.Data, &cr); err != nil || cr.HitDie < 4 {
		return nil, fmt.Errorf("malformed class data for %s: %w", class.Name, err)
	}
	var br backgroundRules
	if err := json.Unmarshal(background.Data, &br); err != nil {
		return nil, fmt.Errorf("malformed background data for %s: %w", background.Name, err)
	}
	if len(body.Skills) != cr.SkillChoices.Choose {
		return badRequest(fmt.Sprintf("%s grants %d skill choices", class.Name, cr.SkillChoices.Choose))
	}
	wildcard := len(cr.SkillChoices.From) == 1 && cr.SkillChoices.From[0] == "*"
	allowed := map[string]bool{}
	for _, sk := range cr.SkillChoices.From {
		allowed[sk] = true
	}
	granted := map[string]bool{}
	for _, sk := range br.Skills {
		granted[sk] = true
	}
	seen := map[string]bool{}
	for _, sk := range body.Skills {
		if seen[sk] {
			return badRequest("duplicate skill choice: " + sk)
		}
		seen[sk] = true
		if !allSkills[sk] {
			return badRequest("unknown skill: " + sk)
		}
		if !wildcard && !allowed[sk] {
			return badRequest(class.Name + " cannot choose " + sk)
		}
		if granted[sk] {
			return badRequest(sk + " is already granted by " + background.Name + " — choose another")
		}
	}
	// Full proficiency list = background grants + class choices.
	skills := append(append([]string{}, br.Skills...), body.Skills...)

	// Level 1 derivations.
	hpMax := cr.HitDie + abilityMod(body.Abilities.Con)
	if hpMax < 1 {
		hpMax = 1
	}

	s16 := func(v int) *int16 { x := int16(v); return &x }
	hero, err := s.queries.ForgeCharacter(ctx, db.ForgeCharacterParams{
		OwnerUserID:  uid,
		Name:         name,
		Class:        species.Name + " " + class.Name,
		Level:        1,
		HpCurrent:    int32(hpMax),
		HpMax:        int32(hpMax),
		Strength:     s16(body.Abilities.Str),
		Dexterity:    s16(body.Abilities.Dex),
		Constitution: s16(body.Abilities.Con),
		Intelligence: s16(body.Abilities.Int),
		Wisdom:       s16(body.Abilities.Wis),
		Charisma:     s16(body.Abilities.Cha),
		Skills:       skills,
		ClassID:      pgUUID(class.ID),
		SpeciesID:    pgUUID(species.ID),
		BackgroundID: pgUUID(background.ID),
	})
	if err != nil {
		return nil, err
	}
	me, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.ForgeCharacter201JSONResponse(toAPICharacter(hero, me.Name, uid)), nil
}
