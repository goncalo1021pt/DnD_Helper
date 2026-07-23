package http

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// requireCharacterViewer allows the owner always; anyone else only when the
// hero is seated at a campaign they belong to.
func (s *Server) requireCharacterViewer(ctx context.Context, character db.Character) error {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return errNoAuth
	}
	if uid == character.OwnerUserID {
		return nil
	}
	campaignID, seated := seatedCampaign(character)
	if !seated {
		// A hero waiting at a barred door may be previewed by that
		// table's DM before the seat is granted.
		if req, err := s.queries.GetSeatRequest(ctx, character.ID); err == nil {
			if _, dmErr := s.requireDM(ctx, req.CampaignID); dmErr == nil {
				return nil
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return errForbidden
	}
	_, err := s.requireMember(ctx, campaignID)
	return err
}

// classDataFor loads the raw class JSON behind a hero, or nil for freeform
// heroes (and dangling references).
func (s *Server) classDataFor(ctx context.Context, c db.Character) []byte {
	if !c.ClassID.Valid {
		return nil
	}
	row, err := s.queries.GetContent(ctx, uuid.UUID(c.ClassID.Bytes))
	if err != nil {
		return nil
	}
	return row.Data
}

// GetCharacter returns the full sheet: the hero, their spells, and inventory.
func (s *Server) GetCharacter(ctx context.Context, request api.GetCharacterRequestObject) (api.GetCharacterResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if err := s.requireCharacterViewer(ctx, character); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	uid, _ := auth.UserID(ctx)

	ownerName, err := s.ownerName(ctx, character.OwnerUserID)
	if err != nil {
		return nil, err
	}
	spellRows, err := s.queries.ListCharacterSpells(ctx, character.ID)
	if err != nil {
		return nil, err
	}
	spells := make([]api.RulesContent, 0, len(spellRows))
	for _, row := range spellRows {
		spells = append(spells, toAPIRulesContent(db.RulesContent{
			ID: row.ID, Kind: row.Kind, Source: row.Source,
			Name: row.Name, Summary: row.Summary, Data: row.Data,
			CreatedBy: row.CreatedBy,
		}, row.CreatorName, uid))
	}
	itemRows, err := s.queries.ListCharacterItems(ctx, character.ID)
	if err != nil {
		return nil, err
	}
	items := make([]api.InventoryItem, 0, len(itemRows))
	for _, row := range itemRows {
		items = append(items, toAPIInventoryItem(row, uid))
	}

	return api.GetCharacter200JSONResponse(api.CharacterDetail{
		Character: toAPICharacterWithClass(character, ownerName, uid, s.classDataFor(ctx, character)),
		Spells:    spells,
		Items:     items,
	}), nil
}

// SetSpellSlots stores slots spent per spell level (owner or DM).
func (s *Server) SetSpellSlots(ctx context.Context, request api.SetSpellSlotsRequestObject) (api.SetSpellSlotsResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetSpellSlots404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireCharacterEditor(ctx, character); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetSpellSlots401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetSpellSlots403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.SetSpellSlotsResponseObject, error) {
		return api.SetSpellSlots400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a slots body is required")
	}

	classData := s.classDataFor(ctx, character)
	var cr castingRules
	if classData == nil || json.Unmarshal(classData, &cr) != nil || cr.Spellcaster == "" {
		return badRequest("this hero does not cast spells")
	}
	table := rules.SlotTable(cr.Spellcaster, int(character.Level))
	used := make([]int16, 9)
	for i, u := range request.Body.Used {
		if i >= 9 {
			break
		}
		if u < 0 || u > table[i] {
			return badRequest("slots spent cannot exceed the slots the hero has")
		}
		used[i] = int16(u)
	}

	updated, err := s.queries.SetSpellSlotsUsed(ctx, db.SetSpellSlotsUsedParams{
		ID:             character.ID,
		SpellSlotsUsed: used,
	})
	if err != nil {
		return nil, err
	}
	ownerName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	return api.SetSpellSlots200JSONResponse(toAPICharacterWithClass(updated, ownerName, uid, classData)), nil
}
