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

// The class-data slice level-up needs. Defaults follow the 2024 rules:
// subclass at 3, ASIs at 4/8/12/16/19.
type levelUpClassRules struct {
	HitDie        int   `json:"hitDie"`
	SubclassLevel int   `json:"subclassLevel"`
	AsiLevels     []int `json:"asiLevels"`
}

type subclassRules struct {
	Class string `json:"class"`
}

// LevelUpCharacter advances a forged hero one level: HP by average or roll,
// subclass at the class's subclass level, ASI or feat at ASI levels. CON
// increases raise max HP retroactively, as the 2024 rules do.
func (s *Server) LevelUpCharacter(ctx context.Context, request api.LevelUpCharacterRequestObject) (api.LevelUpCharacterResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.LevelUpCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	badRequest := func(msg string) (api.LevelUpCharacterResponseObject, error) {
		return api.LevelUpCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}

	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.LevelUpCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if character.OwnerUserID != uid {
		return api.LevelUpCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if request.Body == nil {
		return badRequest("a level-up body is required")
	}
	body := request.Body

	if !character.ClassID.Valid || character.Constitution == nil {
		return badRequest("only forged heroes level up here — quick-add heroes edit their level directly")
	}
	if character.Level >= 20 {
		return badRequest("already at the summit — level 20 is the end of the road")
	}
	newLevel := int(character.Level) + 1

	class, err := s.fetchContent(ctx, uuid.UUID(character.ClassID.Bytes), db.ContentKindClass)
	if err != nil {
		return nil, fmt.Errorf("hero's class vanished: %w", err)
	}
	var cr levelUpClassRules
	if err := json.Unmarshal(class.Data, &cr); err != nil || cr.HitDie < 4 {
		return nil, fmt.Errorf("malformed class data for %s", class.Name)
	}
	if cr.SubclassLevel == 0 {
		cr.SubclassLevel = 3
	}
	if len(cr.AsiLevels) == 0 {
		cr.AsiLevels = []int{4, 8, 12, 16, 19}
	}

	// --- Ability increases / feat (ASI levels only) ---
	abilities := map[string]int{
		"str": int(*character.Strength), "dex": int(*character.Dexterity),
		"con": int(*character.Constitution), "int": int(*character.Intelligence),
		"wis": int(*character.Wisdom), "cha": int(*character.Charisma),
	}
	conModBefore := abilityMod(abilities["con"])

	asiLevel := false
	for _, lv := range cr.AsiLevels {
		if lv == newLevel {
			asiLevel = true
		}
	}
	increases := map[string]int{}
	if body.Asi != nil {
		read := func(key string, v *int) {
			if v != nil {
				increases[key] = *v
			}
		}
		read("str", body.Asi.Str)
		read("dex", body.Asi.Dex)
		read("con", body.Asi.Con)
		read("int", body.Asi.Int)
		read("wis", body.Asi.Wis)
		read("cha", body.Asi.Cha)
	}
	hasASI := len(increases) > 0
	hasFeat := body.FeatId != nil

	if !asiLevel && (hasASI || hasFeat) {
		return badRequest(fmt.Sprintf("%s gains no ability increase at level %d", class.Name, newLevel))
	}
	if asiLevel && hasASI == hasFeat {
		return badRequest("an ASI level takes either ability increases or a feat — exactly one")
	}
	if hasASI {
		total := 0
		for ab, inc := range increases {
			if inc < 1 || inc > 2 {
				return badRequest("each ability increase must be +1 or +2")
			}
			total += inc
			if abilities[ab]+inc > 20 {
				return badRequest(strings.ToUpper(ab) + " cannot rise above 20")
			}
		}
		if total != 2 {
			return badRequest("ability increases must total exactly 2 points (+2 to one or +1 to two)")
		}
		for ab, inc := range increases {
			abilities[ab] += inc
		}
	}

	feats := character.Feats
	if feats == nil {
		feats = []string{}
	}
	if hasFeat {
		feat, err := s.fetchVisibleContent(ctx, uuid.UUID(*body.FeatId), db.ContentKindFeat, uid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return badRequest("unknown feat")
			}
			return badRequest("that choice is not a feat")
		}
		for _, f := range feats {
			if f == feat.Name {
				return badRequest(character.Name + " already has " + feat.Name)
			}
		}
		feats = append(feats, feat.Name)
	}

	// --- Subclass (exactly at the class's subclass level) ---
	subclassID := character.SubclassID
	if newLevel == cr.SubclassLevel {
		if body.SubclassId == nil {
			return badRequest(fmt.Sprintf("%s chooses a subclass at level %d", class.Name, newLevel))
		}
		sub, err := s.fetchVisibleContent(ctx, uuid.UUID(*body.SubclassId), db.ContentKindSubclass, uid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return badRequest("unknown subclass")
			}
			return badRequest("that choice is not a subclass")
		}
		var sr subclassRules
		if err := json.Unmarshal(sub.Data, &sr); err != nil || !strings.EqualFold(sr.Class, class.Name) {
			return badRequest(sub.Name + " does not belong to " + class.Name)
		}
		subclassID = pgUUID(sub.ID)
	} else if body.SubclassId != nil {
		return badRequest(fmt.Sprintf("%s chooses a subclass at level %d, not %d", class.Name, cr.SubclassLevel, newLevel))
	}

	// --- New spells (casters only, additions validated against the new level) ---
	var newSpells []uuid.UUID
	if body.Spells != nil {
		for _, id := range *body.Spells {
			newSpells = append(newSpells, uuid.UUID(id))
		}
	}
	existingSpells, err := s.queries.ListCharacterSpells(ctx, character.ID)
	if err != nil {
		return nil, err
	}
	if msg, _, err := s.validateSpellPicks(ctx, uid, class, newLevel, existingSpells, newSpells); err != nil {
		return nil, err
	} else if msg != "" {
		return badRequest(msg)
	}

	// Milestone tables gate level-ups on a pending allowance (XP is advisory).
	if campaignID, seated := seatedCampaign(character); seated {
		campaign, err := s.queries.GetCampaign(ctx, campaignID)
		if err != nil {
			return nil, err
		}
		if campaign.Progression == db.ProgressionModeMilestone && character.PendingLevels < 1 {
			return badRequest("no milestone reached yet — the DM decides when the party rises")
		}
	}

	// A seated hero's new choices must also be legal in that campaign's world.
	if campaignID, seated := seatedCampaign(character); seated {
		var chosen []uuid.UUID
		if hasFeat {
			chosen = append(chosen, uuid.UUID(*body.FeatId))
		}
		if newLevel == cr.SubclassLevel && body.SubclassId != nil {
			chosen = append(chosen, uuid.UUID(*body.SubclassId))
		}
		chosen = append(chosen, newSpells...)
		blockers, err := s.codexBlockers(ctx, campaignID, chosen)
		if err != nil {
			return nil, err
		}
		if len(blockers) > 0 {
			return badRequest(blockers[0].row.Name + " is not admitted by the campaign's codex — ask the DM")
		}
	}

	// --- Hit points ---
	var die int
	switch body.HpMode {
	case api.Average:
		die = cr.HitDie/2 + 1
	case api.Roll:
		if body.HpRoll == nil {
			return badRequest("hpMode roll needs the hpRoll die result")
		}
		die = *body.HpRoll
		if die < 1 || die > cr.HitDie {
			return badRequest(fmt.Sprintf("hpRoll must be between 1 and %d for a d%d class", cr.HitDie, cr.HitDie))
		}
	default:
		return badRequest("hpMode must be average or roll")
	}
	conModAfter := abilityMod(abilities["con"])
	gain := die + conModAfter
	if gain < 1 {
		gain = 1
	}
	// A CON modifier increase applies to every level already lived.
	retro := (conModAfter - conModBefore) * int(character.Level)
	delta := int32(gain + retro)

	s16 := func(v int) *int16 { x := int16(v); return &x }
	updated, err := s.queries.LevelUpCharacter(ctx, db.LevelUpCharacterParams{
		ID:           character.ID,
		Level:        int32(newLevel),
		HpMax:        character.HpMax + delta,
		HpCurrent:    character.HpCurrent + delta,
		Strength:     s16(abilities["str"]),
		Dexterity:    s16(abilities["dex"]),
		Constitution: s16(abilities["con"]),
		Intelligence: s16(abilities["int"]),
		Wisdom:       s16(abilities["wis"]),
		Charisma:     s16(abilities["cha"]),
		SubclassID:   subclassID,
		Feats:        feats,
	})
	if err != nil {
		return nil, err
	}
	if len(newSpells) > 0 {
		if err := s.queries.AddCharacterSpells(ctx, db.AddCharacterSpellsParams{
			CharacterID: updated.ID,
			Column2:     newSpells,
		}); err != nil {
			return nil, err
		}
	}
	if campaignID, seated := seatedCampaign(character); seated {
		if err := s.queries.SpendPendingLevel(ctx, character.ID); err != nil {
			return nil, err
		}
		s.logEvent(ctx, campaignID, uid, "level_up",
			fmt.Sprintf("%s rises to level %d", character.Name, newLevel))
		if fresh, err := s.queries.GetCharacter(ctx, updated.ID); err == nil {
			updated = fresh
		}
	}
	ownerName, err := s.ownerName(ctx, character.OwnerUserID)
	if err != nil {
		return nil, err
	}
	return api.LevelUpCharacter200JSONResponse(toAPICharacterWithClass(updated, ownerName, uid, class.Data)), nil
}
