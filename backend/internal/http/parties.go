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
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Parties: named groups of heroes inside one campaign (#232).

The table this exists for has ten or twelve players and more than one session
group, on different objectives in the same world. That is the West Marches
shape, and its governing rule is that knowledge belongs to the heroes who were
there — not to a group, which is a thing that changes.

So a party is a BRUSH, not a gate. Revealing a notice "to the Harbour Crew"
stamps the very same per-hero exceptions the DM could have clicked one at a
time, and then the party is forgotten: every resolver in the app is untouched,
because none of them has ever heard of a party. The consequences fall out of
that single decision and are all the ones a table would want —

  - moving a hero to another party takes nothing away from them;
  - disbanding a party takes nothing away from anybody;
  - a hero who joins later does not silently inherit a back-catalogue of
    secrets they were never told.

The one place that could not be brushed is fog, because a batch holds circles
rather than per-hero rows. It records the heroes standing in the party at the
moment of the stamp instead (see fog.go), which comes to the same thing.
*/

const errUnknownParty = "that party does not ride at this table"

func partyName(raw string) (string, string) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", "a party needs a name"
	}
	if len(name) > 60 {
		return "", "that name is too long for a party"
	}
	return name, ""
}

func toAPIParty(p db.ListPartiesRow) api.Party {
	return api.Party{
		Id:         p.ID,
		CampaignId: p.CampaignID,
		Name:       p.Name,
		HeroCount:  int(p.HeroCount),
	}
}

// requirePartyDM resolves a party and enforces the DM role over its campaign.
func (s *Server) requirePartyDM(ctx context.Context, partyID uuid.UUID) (db.Party, error) {
	p, err := s.queries.GetParty(ctx, partyID)
	if err != nil {
		return db.Party{}, err
	}
	if _, err := s.requireDM(ctx, p.CampaignID); err != nil {
		return p, err
	}
	return p, nil
}

// oneParty re-reads a party with its count, so every write answers with the
// same shape the list does.
func (s *Server) oneParty(ctx context.Context, campaignID, partyID uuid.UUID) (api.Party, error) {
	rows, err := s.queries.ListParties(ctx, campaignID)
	if err != nil {
		return api.Party{}, err
	}
	for _, r := range rows {
		if r.ID == partyID {
			return toAPIParty(r), nil
		}
	}
	return api.Party{}, pgx.ErrNoRows
}

// ListParties is open to the whole table: who rides with whom is not a secret
// from the people riding.
func (s *Server) ListParties(ctx context.Context, request api.ListPartiesRequestObject) (api.ListPartiesResponseObject, error) {
	m, err := s.requireMember(ctx, request.CampaignId)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListParties401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListParties403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	rows, err := s.queries.ListParties(ctx, request.CampaignId)
	if err != nil {
		return nil, err
	}
	// A player is told about their own party and no other: the roster is
	// partitioned, so the names of the groups they are not in would be the one
	// thing left leaking through (#232).
	var mine map[uuid.UUID]bool
	if m.Role != db.MembershipRoleDm {
		if mine, err = s.viewerParties(ctx, request.CampaignId, m.UserID); err != nil {
			return nil, err
		}
	}
	out := make([]api.Party, 0, len(rows))
	for _, r := range rows {
		if mine != nil && !mine[r.ID] {
			continue
		}
		out = append(out, toAPIParty(r))
	}
	return api.ListParties200JSONResponse(out), nil
}

func (s *Server) CreateParty(ctx context.Context, request api.CreatePartyRequestObject) (api.CreatePartyResponseObject, error) {
	if _, err := s.requireDM(ctx, request.CampaignId); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateParty401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateParty403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.CreateParty400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a party is required"}}, nil
	}
	name, msg := partyName(request.Body.Name)
	if msg != "" {
		return api.CreateParty400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	p, err := s.queries.CreateParty(ctx, db.CreatePartyParams{CampaignID: request.CampaignId, Name: name})
	if err != nil {
		return nil, err
	}
	s.publish(request.CampaignId, live.TopicParty)
	return api.CreateParty201JSONResponse(api.Party{
		Id: p.ID, CampaignId: p.CampaignID, Name: p.Name, HeroCount: 0,
	}), nil
}

func (s *Server) RenameParty(ctx context.Context, request api.RenamePartyRequestObject) (api.RenamePartyResponseObject, error) {
	p, err := s.requirePartyDM(ctx, uuid.UUID(request.PartyId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.RenameParty404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.RenameParty401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.RenameParty403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.RenameParty400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a party is required"}}, nil
	}
	name, msg := partyName(request.Body.Name)
	if msg != "" {
		return api.RenameParty400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if _, err := s.queries.RenameParty(ctx, db.RenamePartyParams{ID: p.ID, Name: name}); err != nil {
		return nil, err
	}
	out, err := s.oneParty(ctx, p.CampaignID, p.ID)
	if err != nil {
		return nil, err
	}
	s.publish(p.CampaignID, live.TopicParty)
	return api.RenameParty200JSONResponse(out), nil
}

// DeleteParty disbands one. Nothing is revoked, because nothing was ever hung
// on the party: the heroes' party_id falls to NULL and every stamp they were
// given stays on its own row.
func (s *Server) DeleteParty(ctx context.Context, request api.DeletePartyRequestObject) (api.DeletePartyResponseObject, error) {
	p, err := s.requirePartyDM(ctx, uuid.UUID(request.PartyId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteParty404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteParty401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteParty403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteParty(ctx, p.ID); err != nil {
		return nil, err
	}
	// The roster regroups and the map's ledger loses a label at once.
	s.publish(p.CampaignID, live.TopicParty)
	s.publish(p.CampaignID, live.TopicMap)
	return api.DeleteParty204Response{}, nil
}

// SetCharacterParty moves a hero between parties, or out of all of them. The
// DM's alone: which group a hero rides with is a table decision, not a player's.
func (s *Server) SetCharacterParty(ctx context.Context, request api.SetCharacterPartyRequestObject) (api.SetCharacterPartyResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetCharacterParty404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	campaignID, seated := seatedCampaign(character)
	if !seated || character.Kind != db.CharacterKindHero {
		return api.SetCharacterParty400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "only a hero seated at this table rides with a party",
		}}, nil
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetCharacterParty401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetCharacterParty403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}

	var target pgtype.UUID
	if request.Body != nil && request.Body.PartyId != nil {
		p, err := s.queries.GetParty(ctx, *request.Body.PartyId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return api.SetCharacterParty400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownParty}}, nil
			}
			return nil, err
		}
		if p.CampaignID != campaignID {
			return api.SetCharacterParty400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownParty}}, nil
		}
		target = pgUUID(p.ID)
	}
	if _, err := s.queries.SetCharacterParty(ctx, db.SetCharacterPartyParams{
		ID: character.ID, PartyID: target,
	}); err != nil {
		return nil, err
	}

	moved, err := s.queries.GetCharacter(ctx, character.ID)
	if err != nil {
		return nil, err
	}
	owner, err := s.queries.GetUserByID(ctx, moved.OwnerUserID)
	if err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	s.publish(campaignID, live.TopicParty)
	return api.SetCharacterParty200JSONResponse(toAPICharacter(moved, owner.Name, uid)), nil
}

// viewerParties is the set of parties a member rides with — the parties of
// their own seated heroes. A member with no hero, or none yet sorted, rides
// with the zero party, which is how "riding with nobody" is spelled.
//
// The DM is not asked: they see the whole table, always.
func (s *Server) viewerParties(ctx context.Context, campaignID, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := s.queries.ListHeroPartiesByCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	mine := map[uuid.UUID]bool{}
	for _, r := range rows {
		if r.OwnerUserID != userID {
			continue
		}
		if r.PartyID.Valid {
			mine[uuid.UUID(r.PartyID.Bytes)] = true
		} else {
			mine[uuid.Nil] = true
		}
	}
	if len(mine) == 0 {
		mine[uuid.Nil] = true
	}
	return mine, nil
}

// ridesWith reports whether a hero belongs to one of the viewer's parties.
// A hero riding with nobody is the company of everybody else riding with
// nobody — which is exactly a table that has not been sorted yet, and is why
// a campaign with no parties reads precisely as it always did.
func ridesWith(heroParty pgtype.UUID, mine map[uuid.UUID]bool) bool {
	if heroParty.Valid {
		return mine[uuid.UUID(heroParty.Bytes)]
	}
	return mine[uuid.Nil]
}
