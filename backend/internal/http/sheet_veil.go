package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

// sheetVeil answers "may this player read that hero's numbers?" at one table.
//
// A table with the veil drawn keeps every hero a stranger: a player sees the
// names on the roster and nothing else. Two exceptions stand above the veil —
// a hero's own owner, who always reads their sheet, and the DM, who reads the
// whole table. The DM lifts the veil hero by hero, so a party can be
// introduced one sheet at a time.
type sheetVeil struct {
	drawn    bool
	revealed map[uuid.UUID]bool
}

// loadSheetVeil reads the veil for a campaign by id.
func (s *Server) loadSheetVeil(ctx context.Context, campaignID uuid.UUID) (sheetVeil, error) {
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return sheetVeil{}, err
	}
	return s.veilOf(ctx, campaign)
}

// veilOf reads the veil for a campaign already in hand. The reveals are loaded
// whatever the flag says: the DM's controls show who stands in the light even
// while the veil is down, and lowering it is not the same as forgetting.
func (s *Server) veilOf(ctx context.Context, campaign db.Campaign) (sheetVeil, error) {
	v := sheetVeil{drawn: campaign.HiddenSheets, revealed: map[uuid.UUID]bool{}}
	ids, err := s.queries.ListCharacterReveals(ctx, campaign.ID)
	if err != nil {
		return sheetVeil{}, err
	}
	for _, id := range ids {
		v.revealed[id] = true
	}
	return v, nil
}

// concealsFrom reports whether this hero's numbers must be kept from the
// viewer. Owners and the DM are never concealed from.
func (v sheetVeil) concealsFrom(characterID, ownerID, viewer uuid.UUID, isDM bool) bool {
	if !v.drawn || isDM || ownerID == viewer {
		return false
	}
	return !v.revealed[characterID]
}

// conceal strips a hero down to what the veil leaves standing: their name, who
// plays them, and the table they sit at. Every number is emptied rather than
// omitted — the API's shape does not change under the veil, so a client that
// ignores `concealed` reads zeroes instead of somebody's real hit points.
func conceal(c api.Character) api.Character {
	yes := true
	return api.Character{
		Id:           c.Id,
		CampaignId:   c.CampaignId,
		CampaignName: c.CampaignName,
		OwnerUserId:  c.OwnerUserId,
		OwnerName:    c.OwnerName,
		Name:         c.Name,
		Class:        "",
		Level:        0,
		HpCurrent:    0,
		HpMax:        0,
		CreatedAt:    c.CreatedAt,
		Mine:         false,
		TableBorn:    c.TableBorn,
		Kind:         c.Kind,
		Concealed:    &yes,
	}
}

// veiledSheet is the refusal a player meets when they reach for a sheet the
// table keeps from them.
func veiledSheet() api.ForbiddenJSONResponse {
	return api.ForbiddenJSONResponse{
		Error: "this hero's sheet is veiled at this table — only their name is yours to read",
	}
}

// sheetVeiledFrom reports whether the caller is kept from one hero's full
// sheet. An unseated hero has no table to veil them, and an owner is never
// veiled from their own.
//
// Heroes only. A body (#227) is seated and DM-owned, so this would happily
// answer for one — and be wrong, because it is not the veil that rules them:
// ask bodyReadableBy instead (#267).
func (s *Server) sheetVeiledFrom(ctx context.Context, character db.Character, viewer uuid.UUID) (bool, error) {
	campaignID, seated := seatedCampaign(character)
	if !seated || character.OwnerUserID == viewer {
		return false, nil
	}
	veil, err := s.loadSheetVeil(ctx, campaignID)
	if err != nil {
		return false, err
	}
	if !veil.drawn {
		return false, nil
	}
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		// Not at this table at all: the caller reached the sheet by some other
		// door (a seat request preview), and the veil holds.
		if errors.Is(err, errForbidden) || errors.Is(err, errNoAuth) {
			return true, nil
		}
		return false, err
	}
	return veil.concealsFrom(character.ID, character.OwnerUserID, viewer, member.Role == db.MembershipRoleDm), nil
}

// SetHiddenSheets draws or lifts the table's veil (DM only).
func (s *Server) SetHiddenSheets(ctx context.Context, request api.SetHiddenSheetsRequestObject) (api.SetHiddenSheetsResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetHiddenSheets401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetHiddenSheets403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetHiddenSheets400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a body is required"}}, nil
	}

	updated, err := s.queries.SetHiddenSheets(ctx, db.SetHiddenSheetsParams{
		ID: campaignID, HiddenSheets: request.Body.Enabled,
	})
	if err != nil {
		return nil, err
	}
	if request.Body.Enabled {
		s.logEvent(ctx, campaignID, member.UserID, "table_rules",
			"The DM draws a veil over the sheets — heroes know one another by name alone")
	} else {
		s.logEvent(ctx, campaignID, member.UserID, "table_rules",
			"The DM lifts the veil — the party's sheets are open again")
	}
	return api.SetHiddenSheets200JSONResponse(toAPICampaign(updated, true)), nil
}

// RevealCharacter lifts (or drops) the veil on one seated hero (DM only).
func (s *Server) RevealCharacter(ctx context.Context, request api.RevealCharacterRequestObject) (api.RevealCharacterResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.RevealCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	campaignID, seated := seatedCampaign(character)
	if !seated {
		return api.RevealCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "this hero sits at no table — there is no veil to lift",
		}}, nil
	}
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.RevealCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.RevealCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	// A body is not veiled by the table's sheet rule, so lifting it here would
	// write a row that decides nothing (#267). Their person's stats veil is the
	// switch, and it is on the Folk page. Asked after the DM check, so a player
	// learns nothing about the sheet they were refused.
	if character.Kind == db.CharacterKindNpc {
		return api.RevealCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "this sheet belongs to one of the Folk — open their stats on the Folk page instead",
		}}, nil
	}
	if request.Body == nil {
		return api.RevealCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a body is required"}}, nil
	}

	revealed := request.Body.Revealed
	if err := s.setReveal(ctx, campaignID, character.ID, revealed); err != nil {
		return nil, err
	}

	ownerName, err := s.ownerName(ctx, character.OwnerUserID)
	if err != nil {
		return nil, err
	}
	out := toAPICharacterWithClass(character, ownerName, member.UserID, s.classDataFor(ctx, character), s.classesFor(ctx, character))
	out.Revealed = &revealed
	s.publish(member.CampaignID, live.TopicParty)
	return api.RevealCharacter200JSONResponse(out), nil
}

// setReveal writes one hero's place in the light, or takes it away.
func (s *Server) setReveal(ctx context.Context, campaignID, characterID uuid.UUID, revealed bool) error {
	if !revealed {
		return s.queries.ConcealCharacter(ctx, db.ConcealCharacterParams{
			CampaignID: campaignID, CharacterID: characterID,
		})
	}
	return s.queries.RevealCharacter(ctx, db.RevealCharacterParams{
		CampaignID: campaignID, CharacterID: characterID,
	})
}
