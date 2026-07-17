package http

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

type itemData struct {
	Type string `json:"type"`
}

func toAPIInventoryItem(row db.ListCharacterItemsRow, viewer uuid.UUID) api.InventoryItem {
	slot := api.InventoryItemSlot(row.Slot)
	out := api.InventoryItem{
		Id:       row.ID,
		Name:     row.Name,
		Qty:      int(row.Qty),
		Equipped: row.Equipped,
		Slot:     &slot,
	}
	if row.ContentID.Valid && row.Kind != nil && row.Source != nil {
		summary := ""
		if row.Summary != nil {
			summary = *row.Summary
		}
		content := toAPIRulesContent(db.RulesContent{
			ID: uuid.UUID(row.ContentID.Bytes), Kind: *row.Kind, Source: *row.Source,
			Name: row.Name, Summary: summary, Data: row.Data,
			CreatedBy: row.CreatedBy,
		}, row.CreatorName, viewer)
		out.Content = &content
	}
	return out
}

// loadEditableCharacter is the shared prologue of the inventory handlers.
func (s *Server) loadEditableCharacter(ctx context.Context, id uuid.UUID) (db.Character, error) {
	character, err := s.queries.GetCharacter(ctx, id)
	if err != nil {
		return db.Character{}, err
	}
	if _, err := s.requireCharacterEditor(ctx, character); err != nil {
		return db.Character{}, err
	}
	return character, nil
}

// AddInventoryItem adds a library item or a free-text row to a hero's pack.
func (s *Server) AddInventoryItem(ctx context.Context, request api.AddInventoryItemRequestObject) (api.AddInventoryItemResponseObject, error) {
	character, err := s.loadEditableCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.AddInventoryItem404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.AddInventoryItem401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.AddInventoryItem403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.AddInventoryItemResponseObject, error) {
		return api.AddInventoryItem400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("an item body is required")
	}
	body := request.Body
	uid, _ := auth.UserID(ctx)

	qty := int32(1)
	if body.Qty != nil {
		if *body.Qty < 1 || *body.Qty > 999 {
			return badRequest("quantity must be between 1 and 999")
		}
		qty = int32(*body.Qty)
	}

	var contentID pgtype.UUID
	name := ""
	if body.ContentId != nil {
		row, err := s.fetchVisibleContent(ctx, uuid.UUID(*body.ContentId), db.ContentKindItem, uid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return badRequest("unknown item")
			}
			return badRequest("that choice is not an item")
		}
		// A seated hero only packs what the campaign's world admits.
		if campaignID, seated := seatedCampaign(character); seated {
			blockers, err := s.codexBlockers(ctx, campaignID, []uuid.UUID{row.ID})
			if err != nil {
				return nil, err
			}
			if len(blockers) > 0 {
				return badRequest(row.Name + " is not admitted by the campaign's codex — ask the DM")
			}
		}
		contentID = pgUUID(row.ID)
		name = row.Name
	} else {
		if body.Name == nil {
			return badRequest("an item needs a library entry or a name")
		}
		name = strings.TrimSpace(*body.Name)
		if name == "" || len([]rune(name)) > 80 {
			return badRequest("item name must be between 1 and 80 characters")
		}
	}

	created, err := s.queries.AddCharacterItem(ctx, db.AddCharacterItemParams{
		CharacterID: character.ID,
		ContentID:   contentID,
		Name:        name,
		Qty:         qty,
	})
	if err != nil {
		return nil, err
	}
	return api.AddInventoryItem201JSONResponse(s.freshInventoryItem(ctx, created, uid)), nil
}

// freshInventoryItem re-reads one row through the list query's join shape.
func (s *Server) freshInventoryItem(ctx context.Context, row db.CharacterItem, viewer uuid.UUID) api.InventoryItem {
	items, err := s.queries.ListCharacterItems(ctx, row.CharacterID)
	if err == nil {
		for _, it := range items {
			if it.ID == row.ID {
				return toAPIInventoryItem(it, viewer)
			}
		}
	}
	return api.InventoryItem{Id: row.ID, Name: row.Name, Qty: int(row.Qty), Equipped: row.Equipped}
}

// UpdateInventoryItem changes quantity or equip state; equipping armor or a
// shield unequips any other of the same type in the same transaction.
func (s *Server) UpdateInventoryItem(ctx context.Context, request api.UpdateInventoryItemRequestObject) (api.UpdateInventoryItemResponseObject, error) {
	character, err := s.loadEditableCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.UpdateInventoryItem404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.UpdateInventoryItem401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateInventoryItem403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.UpdateInventoryItemResponseObject, error) {
		return api.UpdateInventoryItem400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a patch body is required")
	}
	row, err := s.queries.GetCharacterItem(ctx, request.ItemId)
	if err != nil || row.CharacterID != character.ID {
		return api.UpdateInventoryItem404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	uid, _ := auth.UserID(ctx)

	qty := row.Qty
	if request.Body.Qty != nil {
		if *request.Body.Qty < 1 || *request.Body.Qty > 999 {
			return badRequest("quantity must be between 1 and 999")
		}
		qty = int32(*request.Body.Qty)
	}

	equipped, slot := row.Equipped, row.Slot
	if request.Body.Slot != nil {
		// Equip into a named slot; the current occupant is displaced.
		want := string(*request.Body.Slot)
		itemType, ok := s.equipType(ctx, row)
		if !ok {
			return badRequest("only armor, shields and weapons can be equipped")
		}
		switch {
		case itemType == "armor" && want != "armor":
			return badRequest("armor is worn, not held — it only fits the armor slot")
		case itemType == "shield" && want != "offhand":
			return badRequest("a shield sits in the off-hand")
		case itemType == "weapon" && want == "armor":
			return badRequest("a weapon can't be worn as armor")
		}
		if err := s.clearSlot(ctx, character.ID, row.ID, want); err != nil {
			return nil, err
		}
		equipped, slot = true, want
	} else if request.Body.Equipped != nil && *request.Body.Equipped != row.Equipped {
		equipped = *request.Body.Equipped
		if equipped {
			// Legacy equip without a slot: infer the natural one.
			itemType, ok := s.equipType(ctx, row)
			if !ok {
				return badRequest("only armor, shields and weapons can be equipped")
			}
			switch itemType {
			case "armor":
				slot = "armor"
			case "shield":
				slot = "offhand"
			default:
				slot = "mainhand"
				if s.slotTaken(ctx, character.ID, row.ID, "mainhand") &&
					!s.slotTaken(ctx, character.ID, row.ID, "offhand") {
					slot = "offhand"
				}
			}
			if err := s.clearSlot(ctx, character.ID, row.ID, slot); err != nil {
				return nil, err
			}
		}
	}
	if !equipped {
		slot = ""
	}

	if _, err := s.queries.UpdateCharacterItem(ctx, db.UpdateCharacterItemParams{
		ID:       row.ID,
		Qty:      qty,
		Equipped: equipped,
		Slot:     slot,
	}); err != nil {
		return nil, err
	}
	updated, err := s.queries.GetCharacterItem(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	return api.UpdateInventoryItem200JSONResponse(s.freshInventoryItem(ctx, updated, uid)), nil
}

// equipType resolves the item type behind a row; free-text rows can't equip.
func (s *Server) equipType(ctx context.Context, row db.CharacterItem) (string, bool) {
	if !row.ContentID.Valid {
		return "", false
	}
	content, err := s.queries.GetContent(ctx, uuid.UUID(row.ContentID.Bytes))
	if err != nil {
		return "", false
	}
	var d itemData
	if err := json.Unmarshal(content.Data, &d); err != nil {
		return "", false
	}
	switch d.Type {
	case "armor", "shield", "weapon":
		return d.Type, true
	}
	return "", false
}

// clearSlot stows whatever else occupies a slot, making room for keepID.
func (s *Server) clearSlot(ctx context.Context, characterID, keepID uuid.UUID, slot string) error {
	items, err := s.queries.ListCharacterItems(ctx, characterID)
	if err != nil {
		return err
	}
	var displaced []uuid.UUID
	for _, it := range items {
		if it.Slot == slot && it.ID != keepID {
			displaced = append(displaced, it.ID)
		}
	}
	if len(displaced) == 0 {
		return nil
	}
	return s.queries.UnequipItems(ctx, db.UnequipItemsParams{
		CharacterID: characterID,
		Column2:     displaced,
	})
}

// slotTaken reports whether another row already sits in a slot.
func (s *Server) slotTaken(ctx context.Context, characterID, keepID uuid.UUID, slot string) bool {
	items, err := s.queries.ListCharacterItems(ctx, characterID)
	if err != nil {
		return false
	}
	for _, it := range items {
		if it.Slot == slot && it.ID != keepID {
			return true
		}
	}
	return false
}

// DeleteInventoryItem removes a row from the pack.
func (s *Server) DeleteInventoryItem(ctx context.Context, request api.DeleteInventoryItemRequestObject) (api.DeleteInventoryItemResponseObject, error) {
	character, err := s.loadEditableCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.DeleteInventoryItem404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.DeleteInventoryItem401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteInventoryItem403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	row, err := s.queries.GetCharacterItem(ctx, request.ItemId)
	if err != nil || row.CharacterID != character.ID {
		return api.DeleteInventoryItem404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if err := s.queries.DeleteCharacterItem(ctx, row.ID); err != nil {
		return nil, err
	}
	return api.DeleteInventoryItem204Response{}, nil
}
