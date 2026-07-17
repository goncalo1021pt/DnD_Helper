package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

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
	StartingEquipment []gearOption `json:"startingEquipment"`
}

type backgroundRules struct {
	Skills    []string `json:"skills"`
	Equipment string   `json:"equipment"`
}

type gearItem struct {
	Name string `json:"name"`
	Qty  int    `json:"qty"`
}

type gearOption struct {
	Label string     `json:"label"`
	Items []gearItem `json:"items"`
	Gold  int        `json:"gold"`
}

var wordQty = map[string]int{
	"two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
	"seven": 7, "eight": 8, "nine": 9, "ten": 10,
}

var (
	goldToken = regexp.MustCompile(`^(\d+)\s*gp$`)
	qtyToken  = regexp.MustCompile(`^(\d+)\s+(.+)$`)
)

// parseEquipmentLine turns a background's prose equipment list ("Two daggers,
// thieves' tools, 16 gp") into inventory rows plus gold.
func parseEquipmentLine(line string) (items []gearItem, gold int) {
	for _, tok := range strings.Split(line, ",") {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		if m := goldToken.FindStringSubmatch(strings.ToLower(tok)); m != nil {
			g, _ := strconv.Atoi(m[1])
			gold += g
			continue
		}
		qty := 1
		if m := qtyToken.FindStringSubmatch(tok); m != nil {
			qty, _ = strconv.Atoi(m[1])
			tok = m[2]
		} else if fields := strings.SplitN(tok, " ", 2); len(fields) == 2 {
			if n, ok := wordQty[strings.ToLower(fields[0])]; ok {
				qty, tok = n, fields[1]
			}
		}
		items = append(items, gearItem{Name: tok, Qty: qty})
	}
	return items, gold
}

func abilityMod(score int) int {
	d := score - 10
	if d < 0 {
		d -= 1 // floor division for negatives
	}
	return d / 2
}

// fetchVisibleContent loads a rules entry, enforces its kind, and hides
// other users' private homebrew (visible = SRD, yours, or campaign-enabled).
func (s *Server) fetchVisibleContent(ctx context.Context, id uuid.UUID, kind db.ContentKind, uid uuid.UUID) (db.RulesContent, error) {
	row, err := s.fetchContent(ctx, id, kind)
	if err != nil {
		return row, err
	}
	if row.Source == db.ContentSourceHomebrew {
		visible, err := s.queries.ContentVisibleTo(ctx, db.ContentVisibleToParams{
			ID:        id,
			CreatedBy: pgUUID(uid),
		})
		if err != nil {
			return db.RulesContent{}, err
		}
		if !visible {
			return db.RulesContent{}, pgx.ErrNoRows
		}
	}
	return row, nil
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
	class, err := s.fetchVisibleContent(ctx, uuid.UUID(body.ClassId), db.ContentKindClass, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return badRequest("unknown class")
		}
		return badRequest("that choice is not a class")
	}
	species, err := s.fetchVisibleContent(ctx, uuid.UUID(body.SpeciesId), db.ContentKindSpecies, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return badRequest("unknown species")
		}
		return badRequest("that choice is not a species")
	}
	background, err := s.fetchVisibleContent(ctx, uuid.UUID(body.BackgroundId), db.ContentKindBackground, uid)
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

	// Starting equipment: an option label from the class's data. Optional so
	// classes without gear data (older homebrew) still forge.
	var chosenGear *gearOption
	if body.Gear != nil && *body.Gear != "" {
		for i := range cr.StartingEquipment {
			if strings.EqualFold(cr.StartingEquipment[i].Label, *body.Gear) {
				chosenGear = &cr.StartingEquipment[i]
				break
			}
		}
		if chosenGear == nil {
			return badRequest(class.Name + " has no starting-equipment option " + *body.Gear)
		}
	}

	// Spell picks (casters only) — validated against the class list and caps.
	var spellIDs []uuid.UUID
	if body.Spells != nil {
		for _, id := range *body.Spells {
			spellIDs = append(spellIDs, uuid.UUID(id))
		}
	}
	if msg, _, err := s.validateSpellPicks(ctx, uid, class, 1, nil, spellIDs); err != nil {
		return nil, err
	} else if msg != "" {
		return badRequest(msg)
	}

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
	if len(spellIDs) > 0 {
		if err := s.queries.AddCharacterSpells(ctx, db.AddCharacterSpellsParams{
			CharacterID: hero.ID,
			Column2:     spellIDs,
		}); err != nil {
			return nil, err
		}
	}

	// Stock the inventory: the chosen class option plus the background's kit.
	// Rows link to armory content where names match; the rest ride as
	// free-text, and coin becomes a Gold Pieces row.
	if chosenGear != nil {
		stock := append([]gearItem{}, chosenGear.Items...)
		gold := chosenGear.Gold
		bgItems, bgGold := parseEquipmentLine(br.Equipment)
		stock = append(stock, bgItems...)
		gold += bgGold
		if gold > 0 {
			stock = append(stock, gearItem{Name: "Gold Pieces", Qty: gold})
		}

		armory, err := s.queries.ListContentByKind(ctx, db.ListContentByKindParams{
			Kind:      db.ContentKindItem,
			CreatedBy: pgUUID(uid),
		})
		if err != nil {
			return nil, err
		}
		byName := map[string]uuid.UUID{}
		for _, it := range armory {
			byName[strings.ToLower(it.Name)] = it.ID
		}
		for _, row := range stock {
			qty := row.Qty
			if qty < 1 {
				qty = 1
			}
			contentID := pgtype.UUID{}
			if id, ok := byName[strings.ToLower(row.Name)]; ok {
				contentID = pgUUID(id)
			} else if id, ok := byName[strings.ToLower(strings.TrimSuffix(row.Name, "s"))]; ok {
				contentID = pgUUID(id)
			}
			if _, err := s.queries.AddCharacterItem(ctx, db.AddCharacterItemParams{
				CharacterID: hero.ID,
				ContentID:   contentID,
				Name:        row.Name,
				Qty:         int32(qty),
			}); err != nil {
				return nil, err
			}
		}
	}

	me, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.ForgeCharacter201JSONResponse(toAPICharacterWithClass(hero, me.Name, uid, class.Data)), nil
}
