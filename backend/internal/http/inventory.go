package http

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

type itemData struct {
	Type       string   `json:"type"`
	Wear       string   `json:"wear"`
	Attunement bool     `json:"attunement"`
	Properties []string `json:"properties"`
}

// slotConflicts says which occupancies collide: a two-handed grip owns both
// hands, so it collides with either of them as well as with itself.
func slotConflicts(a, b string) bool {
	if a == b {
		return true
	}
	hand := func(s string) bool { return s == "mainhand" || s == "offhand" }
	return (a == "bothhands" && hand(b)) || (b == "bothhands" && hand(a))
}

// wearSlots is where each kind of worn item may sit. One slot per kind — a
// hero wears one cloak, the rules and the mirror agree — except rings, which
// get the classic two. Mirrored by slotsFor in frontend/src/components/sheet/items.ts.
var wearSlots = map[string][]string{
	"cloak": {"cloak"}, "amulet": {"amulet"}, "helm": {"helm"},
	"belt": {"belt"}, "boots": {"boots"}, "gloves": {"gloves"},
	"bracers": {"bracers"}, "ring": {"ring1", "ring2"},
}

func toAPIInventoryItem(row db.ListCharacterItemsRow, viewer uuid.UUID) api.InventoryItem {
	slot := api.InventoryItemSlot(row.Slot)
	out := api.InventoryItem{
		Id:       row.ID,
		Name:     row.Name,
		Qty:      int(row.Qty),
		Equipped: row.Equipped,
		Attuned:  row.Attuned,
		IsPurse:  &row.IsPurse,
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
		if *body.Qty < 1 || *body.Qty > 1000000 {
			return badRequest("quantity must be between 1 and 1,000,000")
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

	// Writing in your own coin is how a purse is made, and how it always was
	// — before #195 a row literally named "Gold Pieces" simply WAS the purse.
	// The rule is the same, said out loud: a written-in row named for this
	// table's coin becomes the purse, but only when the hero has none yet, so
	// a second one is a pouch of loose change rather than a rival till.
	purse, err := s.wouldBePurse(ctx, character, contentID, name)
	if err != nil {
		return nil, err
	}
	created, err := s.queries.AddCharacterItem(ctx, db.AddCharacterItemParams{
		CharacterID: character.ID,
		ContentID:   contentID,
		Name:        name,
		Qty:         qty,
		IsPurse:     purse,
	})
	if err != nil {
		return nil, err
	}
	if err := s.syncCombatantAC(ctx, character); err != nil {
		return nil, err
	}
	return api.AddInventoryItem201JSONResponse(s.freshInventoryItem(ctx, created, uid)), nil
}

// wouldBePurse reports whether a freshly written-in row is this hero's coin:
// content-less, named for the table's coin, and the first such row they have.
func (s *Server) wouldBePurse(ctx context.Context, c db.Character, contentID pgtype.UUID, name string) (bool, error) {
	if contentID.Valid {
		return false, nil
	}
	ladder := standardCoinage
	if campaignID, seated := seatedCampaign(c); seated {
		campaign, err := s.queries.GetCampaign(ctx, campaignID)
		if err != nil {
			return false, err
		}
		ladder = coinageOf(campaign.Coinage)
	}
	if !strings.EqualFold(strings.TrimSpace(name), ladder.purseName()) {
		return false, nil
	}
	items, err := s.queries.ListCharacterItems(ctx, c.ID)
	if err != nil {
		return false, err
	}
	return pickPurse(items) == nil, nil
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
	return api.InventoryItem{Id: row.ID, Name: row.Name, Qty: int(row.Qty), Equipped: row.Equipped, Attuned: row.Attuned}
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
		if *request.Body.Qty < 1 || *request.Body.Qty > 1000000 {
			return badRequest("quantity must be between 1 and 1,000,000")
		}
		qty = int32(*request.Body.Qty)
	}

	equipped, slot := row.Equipped, row.Slot
	if request.Body.Slot != nil {
		// Equip into a named slot; the current occupant is displaced.
		want := string(*request.Body.Slot)
		d, ok := s.equipData(ctx, row)
		if !ok {
			return badRequest("only armor, shields, weapons and worn items can be equipped")
		}
		twoHanded := slices.Contains(d.Properties, "Two-Handed")
		versatile := slices.Contains(d.Properties, "Versatile")
		switch {
		case d.Type == "armor" && want != "armor":
			return badRequest("armor is worn, not held — it only fits the armor slot")
		case d.Type == "shield" && want != "offhand":
			return badRequest("a shield sits in the off-hand")
		case d.Type == "weapon" && twoHanded && want != "bothhands":
			return badRequest("that weapon takes both hands — there is no one-handed grip")
		case d.Type == "weapon" && want == "bothhands" && !twoHanded && !versatile:
			return badRequest("only a versatile or two-handed weapon fills both hands")
		case d.Type == "weapon" && want != "mainhand" && want != "offhand" && want != "bothhands":
			return badRequest("a weapon is held, not worn — main hand, off hand or both")
		case d.Type == "gear" && !slices.Contains(wearSlots[d.Wear], want):
			return badRequest("that is worn as a " + d.Wear + " — it fits no other place")
		}
		if err := s.clearSlot(ctx, character.ID, row.ID, want); err != nil {
			return nil, err
		}
		equipped, slot = true, want
	} else if request.Body.Equipped != nil && *request.Body.Equipped != row.Equipped {
		equipped = *request.Body.Equipped
		if equipped {
			// Legacy equip without a slot: infer the natural one.
			d, ok := s.equipData(ctx, row)
			if !ok {
				return badRequest("only armor, shields, weapons and worn items can be equipped")
			}
			switch {
			case d.Type == "armor":
				slot = "armor"
			case d.Type == "shield":
				slot = "offhand"
			case d.Type == "weapon":
				slot = "mainhand"
				if slices.Contains(d.Properties, "Two-Handed") {
					slot = "bothhands"
				} else if s.slotTaken(ctx, character.ID, row.ID, "mainhand") &&
					!s.slotTaken(ctx, character.ID, row.ID, "offhand") {
					slot = "offhand"
				}
			default:
				// A worn kind's own slot; a ring takes the first free hand.
				kinds := wearSlots[d.Wear]
				slot = kinds[0]
				for _, k := range kinds {
					if !s.slotTaken(ctx, character.ID, row.ID, k) {
						slot = k
						break
					}
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

	// The bond is its own act, separate from where the item sits (#189).
	attuned := row.Attuned
	if request.Body.Attuned != nil && *request.Body.Attuned != row.Attuned {
		if *request.Body.Attuned {
			d, hasContent := s.equipContentData(ctx, row)
			if msg := attuneRefusal(hasContent, d, s.attunedCount(ctx, character.ID, row.ID)); msg != "" {
				return badRequest(msg)
			}
		}
		attuned = *request.Body.Attuned
	}

	if _, err := s.queries.UpdateCharacterItem(ctx, db.UpdateCharacterItemParams{
		ID:       row.ID,
		Qty:      qty,
		Equipped: equipped,
		Slot:     slot,
		Attuned:  attuned,
	}); err != nil {
		return nil, err
	}
	updated, err := s.queries.GetCharacterItem(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	// Strapping on a shield mid-fight moves the number the DM is rolling
	// against, so the tracker hears about it (#153).
	if err := s.syncCombatantAC(ctx, character); err != nil {
		return nil, err
	}
	return api.UpdateInventoryItem200JSONResponse(s.freshInventoryItem(ctx, updated, uid)), nil
}

// equipContentData resolves the item data behind a row; false for free-text
// rows and dangling references, which can neither equip nor attune.
func (s *Server) equipContentData(ctx context.Context, row db.CharacterItem) (itemData, bool) {
	if !row.ContentID.Valid {
		return itemData{}, false
	}
	content, err := s.queries.GetContent(ctx, uuid.UUID(row.ContentID.Bytes))
	if err != nil {
		return itemData{}, false
	}
	var d itemData
	if err := json.Unmarshal(content.Data, &d); err != nil {
		return itemData{}, false
	}
	return d, true
}

// equipData is equipContentData narrowed to what may occupy a slot: armor,
// shields, weapons, and gear that declares a wear kind.
func (s *Server) equipData(ctx context.Context, row db.CharacterItem) (itemData, bool) {
	d, ok := s.equipContentData(ctx, row)
	if !ok {
		return itemData{}, false
	}
	switch d.Type {
	case "armor", "shield", "weapon":
		return d, true
	case "gear":
		if _, worn := wearSlots[d.Wear]; worn {
			return d, true
		}
	}
	return itemData{}, false
}

// attuneRefusal is the whole of the attunement rule, kept pure so the tests
// need no database: only a library item that asks for attunement can be
// attuned to, and three bonds are the most a hero can hold (2024 rules).
func attuneRefusal(hasContent bool, d itemData, attunedRows int) string {
	if !hasContent || !d.Attunement {
		return "only an item that requires attunement can be attuned to"
	}
	if attunedRows >= 3 {
		return "three items are the most a hero can attune to"
	}
	return ""
}

// attunedCount counts the hero's attuned rows, besides the one asking.
func (s *Server) attunedCount(ctx context.Context, characterID, keepID uuid.UUID) int {
	items, err := s.queries.ListCharacterItems(ctx, characterID)
	if err != nil {
		return 0
	}
	n := 0
	for _, it := range items {
		if it.Attuned && it.ID != keepID {
			n++
		}
	}
	return n
}

// clearSlot stows whatever the incoming occupancy collides with, making room
// for keepID — a two-handed grip empties both hands, sword and shield alike.
func (s *Server) clearSlot(ctx context.Context, characterID, keepID uuid.UUID, slot string) error {
	items, err := s.queries.ListCharacterItems(ctx, characterID)
	if err != nil {
		return err
	}
	var displaced []uuid.UUID
	for _, it := range items {
		if it.Slot != "" && slotConflicts(it.Slot, slot) && it.ID != keepID {
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

// slotTaken reports whether another row already collides with a slot.
func (s *Server) slotTaken(ctx context.Context, characterID, keepID uuid.UUID, slot string) bool {
	items, err := s.queries.ListCharacterItems(ctx, characterID)
	if err != nil {
		return false
	}
	for _, it := range items {
		if it.Slot != "" && slotConflicts(it.Slot, slot) && it.ID != keepID {
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
	if err := s.syncCombatantAC(ctx, character); err != nil {
		return nil, err
	}
	return api.DeleteInventoryItem204Response{}, nil
}
