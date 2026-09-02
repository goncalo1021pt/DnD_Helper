package http

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Changing prepared spells on a Long Rest.

The 2024 rules put half the casters on this trigger and half on level-up, and
each class's allowance differs — see the spellChanges rule on the class data,
and validateSpellSwaps for the gate. This endpoint is only the Long Rest half;
the level-up half rides along with LevelUpCharacter, since the swap and the new
level have to land together.

There is no rest bookkeeping to do here: the app tracks expended spell slots,
and those are reset by the sheet's own controls. This changes which spells the
hero has ready, nothing else.
*/

// SwapCharacterSpells trades prepared spells after a Long Rest (owner only).
func (s *Server) SwapCharacterSpells(ctx context.Context, request api.SwapCharacterSpellsRequestObject) (api.SwapCharacterSpellsResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.SwapCharacterSpells401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	badRequest := func(msg string) (api.SwapCharacterSpellsResponseObject, error) {
		return api.SwapCharacterSpells400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}

	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SwapCharacterSpells404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	// A hero's spell list is the player's to change — not the DM's, unlike HP.
	if character.OwnerUserID != uid {
		return api.SwapCharacterSpells403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if request.Body == nil || len(request.Body.Swaps) == 0 {
		return badRequest("nothing to swap")
	}
	if !character.ClassID.Valid {
		return badRequest("only forged heroes track a spell list")
	}

	class, err := s.fetchContent(ctx, uuid.UUID(character.ClassID.Bytes), db.ContentKindClass)
	if err != nil {
		return nil, fmt.Errorf("hero's class vanished: %w", err)
	}
	existing, err := s.queries.ListCharacterSpells(ctx, character.ID)
	if err != nil {
		return nil, err
	}
	// The casting may be declared on the class's subclass rather than the
	// class — an Eldritch Knight trades Wizard spells as a Fighter (#220).
	// The trade is judged at the hero's level IN this class, against this
	// class's own spells — never the total level or the whole grimoire (#241).
	var subclassData []byte
	classLevel := int(character.Level)
	for _, k := range s.classesFor(ctx, character) {
		if k.ClassID == class.ID {
			subclassData = k.SubclassData
			classLevel = int(k.Level)
		}
	}

	// A seated hero's trades answer to the table's codex like every other
	// pick; validateSpellSwaps runs that check when a campaign is given, so an
	// unseated hero (uuid.Nil) is ruled by no codex (#239).
	seatedAt, _ := seatedCampaign(character)
	msg, swaps, err := s.validateSpellSwaps(
		ctx, uid, seatedAt, class, subclassData, classLevel,
		spellsOfClass(existing, class.ID, character.ClassID), request.Body.Swaps, "long-rest")
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return badRequest(msg)
	}

	if err := s.applySpellSwaps(ctx, character.ID, pgUUID(class.ID), swaps); err != nil {
		return nil, err
	}

	ownerName, err := s.ownerName(ctx, character.OwnerUserID)
	if err != nil {
		return nil, err
	}
	return api.SwapCharacterSpells200JSONResponse(
		toAPICharacterWithClass(character, ownerName, uid, class.Data, s.classesFor(ctx, character))), nil
}

// applySpellSwaps removes what the hero gave up and adds what it took, in that
// order — a spell can be traded away and its slot refilled in the same breath.
func (s *Server) applySpellSwaps(ctx context.Context, characterID uuid.UUID, classID pgtype.UUID, swaps swapResult) error {
	if len(swaps.Out) > 0 {
		if err := s.queries.RemoveCharacterSpells(ctx, db.RemoveCharacterSpellsParams{
			CharacterID: characterID,
			Column2:     swaps.Out,
		}); err != nil {
			return err
		}
	}
	if len(swaps.In) > 0 {
		if err := s.queries.AddCharacterSpells(ctx, db.AddCharacterSpellsParams{
			CharacterID: characterID,
			Column2:     swaps.In,
			// A swap trades within one class's list, so the replacement keeps
			// the same owner as the spell it replaced.
			ClassID: classID,
		}); err != nil {
			return err
		}
	}
	return nil
}
