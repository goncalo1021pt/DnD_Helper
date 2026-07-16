package http

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// pgUUID wraps a uuid for the nullable campaign_id column.
func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// seatedCampaign returns the campaign a hero is seated at, if any.
func seatedCampaign(c db.Character) (uuid.UUID, bool) {
	if !c.CampaignID.Valid {
		return uuid.UUID{}, false
	}
	return uuid.UUID(c.CampaignID.Bytes), true
}

// ListCharacters returns the campaign's party roster (members only).
func (s *Server) ListCharacters(ctx context.Context, request api.ListCharactersRequestObject) (api.ListCharactersResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListCharacters401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListCharacters403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	out := make([]api.Character, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAPICharacterWithClass(db.Character{
			ID: row.ID, CampaignID: row.CampaignID, OwnerUserID: row.OwnerUserID,
			Name: row.Name, Class: row.Class, Level: row.Level,
			HpCurrent: row.HpCurrent, HpMax: row.HpMax, CreatedAt: row.CreatedAt,
			Strength: row.Strength, Dexterity: row.Dexterity, Constitution: row.Constitution,
			Intelligence: row.Intelligence, Wisdom: row.Wisdom, Charisma: row.Charisma,
			Skills: row.Skills, ClassID: row.ClassID, SpeciesID: row.SpeciesID,
			BackgroundID: row.BackgroundID,
			SubclassID:   row.SubclassID,
			Feats:        row.Feats,
			SpellSlotsUsed: row.SpellSlotsUsed,
			Xp:             row.Xp,
			PendingLevels:  row.PendingLevels,
		}, row.OwnerName, member.UserID, row.ClassData))
	}
	return api.ListCharacters200JSONResponse(out), nil
}

// CreateCharacter adds a character owned by the caller (any campaign member).
func (s *Server) CreateCharacter(ctx context.Context, request api.CreateCharacterRequestObject) (api.CreateCharacterResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	in, errMsg := validateCharacterInput(request.Body)
	if errMsg != "" {
		return api.CreateCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}

	character, err := s.queries.CreateCharacter(ctx, db.CreateCharacterParams{
		CampaignID:  pgUUID(campaignID),
		OwnerUserID: member.UserID,
		Name:        in.name,
		Class:       in.class,
		Level:       in.level,
		HpCurrent:   in.hpCurrent,
		HpMax:       in.hpMax,
	})
	if err != nil {
		return nil, err
	}
	ownerName, err := s.ownerName(ctx, member.UserID)
	if err != nil {
		return nil, err
	}
	return api.CreateCharacter201JSONResponse(toAPICharacter(character, ownerName, member.UserID)), nil
}

// UpdateCharacter edits a character (its owner or the DM).
func (s *Server) UpdateCharacter(ctx context.Context, request api.UpdateCharacterRequestObject) (api.UpdateCharacterResponseObject, error) {
	characterID := uuid.UUID(request.CharacterId)
	character, err := s.queries.GetCharacter(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}

	member, err := s.requireCharacterEditor(ctx, character)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	in, errMsg := validateCharacterInput(request.Body)
	if errMsg != "" {
		return api.UpdateCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}

	updated, err := s.queries.UpdateCharacter(ctx, db.UpdateCharacterParams{
		ID:        characterID,
		Name:      in.name,
		Class:     in.class,
		Level:     in.level,
		HpCurrent: in.hpCurrent,
		HpMax:     in.hpMax,
	})
	if err != nil {
		return nil, err
	}
	ownerName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	return api.UpdateCharacter200JSONResponse(toAPICharacterWithClass(updated, ownerName, member.UserID, s.classDataFor(ctx, updated))), nil
}

// DeleteCharacter removes a character (its owner or the DM).
func (s *Server) DeleteCharacter(ctx context.Context, request api.DeleteCharacterRequestObject) (api.DeleteCharacterResponseObject, error) {
	characterID := uuid.UUID(request.CharacterId)
	character, err := s.queries.GetCharacter(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}

	if _, err := s.requireCharacterEditor(ctx, character); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	if err := s.queries.DeleteCharacter(ctx, characterID); err != nil {
		return nil, err
	}
	return api.DeleteCharacter204Response{}, nil
}

// requireCharacterEditor allows the character's owner or, when the hero is
// seated at a campaign, that campaign's DM. Unseated heroes are owner-only.
func (s *Server) requireCharacterEditor(ctx context.Context, character db.Character) (db.Membership, error) {
	campaignID, seated := seatedCampaign(character)
	if !seated {
		uid, ok := auth.UserID(ctx)
		if !ok {
			return db.Membership{}, errNoAuth
		}
		if uid != character.OwnerUserID {
			return db.Membership{}, errForbidden
		}
		return db.Membership{UserID: uid}, nil
	}
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		return member, err
	}
	if member.UserID != character.OwnerUserID && member.Role != db.MembershipRoleDm {
		return member, errForbidden
	}
	return member, nil
}

type characterInput struct {
	name      string
	class     string
	level     int32
	hpCurrent int32
	hpMax     int32
}

// validateCharacterInput normalizes and bounds-checks the shared create/update
// body. HP current is clamped into [0, hpMax] rather than rejected.
func validateCharacterInput(body *api.CharacterInput) (characterInput, string) {
	if body == nil {
		return characterInput{}, "a character body is required"
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > 80 {
		return characterInput{}, "name must be between 1 and 80 characters"
	}
	class := ""
	if body.Class != nil {
		class = strings.TrimSpace(*body.Class)
	}
	if len([]rune(class)) > 80 {
		return characterInput{}, "class must be at most 80 characters"
	}
	if body.Level < 1 || body.Level > 20 {
		return characterInput{}, "level must be between 1 and 20"
	}
	if body.HpMax < 1 || body.HpMax > 9999 {
		return characterInput{}, "max HP must be between 1 and 9999"
	}
	hpCurrent := min(max(body.HpCurrent, 0), body.HpMax)
	return characterInput{
		name:      name,
		class:     class,
		level:     int32(body.Level),
		hpCurrent: int32(hpCurrent),
		hpMax:     int32(body.HpMax),
	}, ""
}

func (s *Server) ownerName(ctx context.Context, ownerID uuid.UUID) (string, error) {
	owner, err := s.queries.GetUserByID(ctx, ownerID)
	if err != nil {
		return "", err
	}
	return owner.Name, nil
}

// toAPICharacterWithClass enriches a caster's sheet with slot state derived
// from the class data (nil classData = no enrichment).
func toAPICharacterWithClass(c db.Character, ownerName string, viewer uuid.UUID, classData []byte) api.Character {
	out := toAPICharacter(c, ownerName, viewer)
	if out.Sheet != nil && classData != nil {
		ability, slots := spellSlotsFor(classData, c.Level, c.SpellSlotsUsed)
		out.Sheet.SpellcastingAbility = ability
		out.Sheet.SpellSlots = slots
	}
	return out
}

func toAPICharacter(c db.Character, ownerName string, viewer uuid.UUID) api.Character {
	var campaignID *uuid.UUID
	if id, ok := seatedCampaign(c); ok {
		campaignID = &id
	}
	var sheet *api.CharacterSheet
	if c.Strength != nil && c.Dexterity != nil && c.Constitution != nil &&
		c.Intelligence != nil && c.Wisdom != nil && c.Charisma != nil {
		uuidPtr := func(u pgtype.UUID) *uuid.UUID {
			if !u.Valid {
				return nil
			}
			id := uuid.UUID(u.Bytes)
			return &id
		}
		skills := c.Skills
		if skills == nil {
			skills = []string{}
		}
		feats := c.Feats
		if feats == nil {
			feats = []string{}
		}
		sheet = &api.CharacterSheet{
			Abilities: api.AbilityScores{
				Str: int(*c.Strength), Dex: int(*c.Dexterity), Con: int(*c.Constitution),
				Int: int(*c.Intelligence), Wis: int(*c.Wisdom), Cha: int(*c.Charisma),
			},
			Skills:       skills,
			Feats:        &feats,
			ClassId:      uuidPtr(c.ClassID),
			SpeciesId:    uuidPtr(c.SpeciesID),
			BackgroundId: uuidPtr(c.BackgroundID),
			SubclassId:   uuidPtr(c.SubclassID),
		}
	}
	xp := int(c.Xp)
	pending := int(c.PendingLevels)
	return api.Character{
		Sheet:         sheet,
		Xp:            &xp,
		PendingLevels: &pending,
		Id:          c.ID,
		CampaignId:  campaignID,
		OwnerUserId: c.OwnerUserID,
		OwnerName:   ownerName,
		Name:        c.Name,
		Class:       c.Class,
		Level:       int(c.Level),
		HpCurrent:   int(c.HpCurrent),
		HpMax:       int(c.HpMax),
		CreatedAt:   c.CreatedAt.Time,
		Mine:        c.OwnerUserID == viewer,
	}
}
