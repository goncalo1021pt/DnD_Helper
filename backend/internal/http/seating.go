package http

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// SetSeatingApproval bars or opens the table's door (DM only).
func (s *Server) SetSeatingApproval(ctx context.Context, request api.SetSeatingApprovalRequestObject) (api.SetSeatingApprovalResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetSeatingApproval401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetSeatingApproval403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetSeatingApproval400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a body is required"}}, nil
	}
	updated, err := s.queries.SetSeatingApproval(ctx, db.SetSeatingApprovalParams{
		ID: campaignID, RequireSeatingApproval: request.Body.Enabled,
	})
	if err != nil {
		return nil, err
	}
	if request.Body.Enabled {
		s.logEvent(ctx, campaignID, member.UserID, "table_rules",
			"The DM bars the door — new heroes wait for approval")
	} else {
		s.logEvent(ctx, campaignID, member.UserID, "table_rules",
			"The DM opens the door — heroes seat themselves freely")
	}
	return api.SetSeatingApproval200JSONResponse(toAPICampaign(updated)), nil
}

// seatCapMessage words the refusal when a player already fills their seats.
func seatCapMessage(limit int16) string {
	if limit == 1 {
		return "this table seats one hero per player — unseat the other first"
	}
	return fmt.Sprintf("this table seats %d heroes per player — unseat one first", limit)
}

// SetMaxSeatedPerPlayer sets how many heroes one player may seat at once
// (DM only). Lowering it never unseats anyone; it only holds the door.
func (s *Server) SetMaxSeatedPerPlayer(ctx context.Context, request api.SetMaxSeatedPerPlayerRequestObject) (api.SetMaxSeatedPerPlayerResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetMaxSeatedPerPlayer401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetMaxSeatedPerPlayer403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetMaxSeatedPerPlayer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a body is required"}}, nil
	}
	v := request.Body.MaxSeatedPerPlayer
	if v < 1 || v > 10 {
		return api.SetMaxSeatedPerPlayer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the seat cap must sit between 1 and 10",
		}}, nil
	}
	updated, err := s.queries.SetMaxSeatedPerPlayer(ctx, db.SetMaxSeatedPerPlayerParams{
		ID: campaignID, MaxSeatedPerPlayer: int16(v),
	})
	if err != nil {
		return nil, err
	}
	if v == 1 {
		s.logEvent(ctx, campaignID, member.UserID, "table_rules",
			"The DM grants each player a single seat at the table")
	} else {
		s.logEvent(ctx, campaignID, member.UserID, "table_rules",
			fmt.Sprintf("The DM grants each player %d seats at the table", v))
	}
	return api.SetMaxSeatedPerPlayer200JSONResponse(toAPICampaign(updated)), nil
}

// ListSeatRequests returns the heroes waiting at the door (DM only).
func (s *Server) ListSeatRequests(ctx context.Context, request api.ListSeatRequestsRequestObject) (api.ListSeatRequestsResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ListSeatRequests404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListSeatRequests401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListSeatRequests403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.queries.ListSeatRequests(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out := make([]api.PendingSeat, 0, len(rows))
	for _, r := range rows {
		class := r.Class
		out = append(out, api.PendingSeat{
			CharacterId: r.CharacterID,
			Name:        r.Name,
			Class:       &class,
			Level:       int(r.Level),
			OwnerName:   r.OwnerName,
			RequestedAt: r.CreatedAt.Time,
		})
	}
	return api.ListSeatRequests200JSONResponse(out), nil
}

// ApproveSeatRequest seats a waiting hero (DM only), re-checking the codex —
// the world may have changed while they stood at the door.
func (s *Server) ApproveSeatRequest(ctx context.Context, request api.ApproveSeatRequestRequestObject) (api.ApproveSeatRequestResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	characterID := uuid.UUID(request.CharacterId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ApproveSeatRequest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ApproveSeatRequest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	req, err := s.queries.GetSeatRequest(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ApproveSeatRequest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if req.CampaignID != campaignID {
		return api.ApproveSeatRequest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	character, err := s.queries.GetCharacter(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ApproveSeatRequest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	// The player may have been kicked while their hero waited.
	if _, err := s.queries.GetMembership(ctx, db.GetMembershipParams{
		UserID: character.OwnerUserID, CampaignID: campaignID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, err := s.queries.DeleteSeatRequest(ctx, characterID); err != nil {
				return nil, err
			}
			return api.ApproveSeatRequest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}

	// The cap may have filled while the hero stood at the door (#171).
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	seated, err := s.queries.CountSeatedByOwner(ctx, db.CountSeatedByOwnerParams{
		OwnerUserID: character.OwnerUserID, CampaignID: pgUUID(campaignID), ID: characterID,
	})
	if err != nil {
		return nil, err
	}
	if seated >= int64(campaign.MaxSeatedPerPlayer) {
		return api.ApproveSeatRequest400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: seatCapMessage(campaign.MaxSeatedPerPlayer),
		}}, nil
	}

	refs, err := s.sheetContentIDs(ctx, character)
	if err != nil {
		return nil, err
	}
	blockers, err := s.codexBlockers(ctx, campaignID, refs)
	if err != nil {
		return nil, err
	}
	if len(blockers) > 0 {
		conflict := api.SeatConflict{Error: "the codex has not admitted this hero's lineage"}
		for _, b := range blockers {
			conflict.Missing = append(conflict.Missing, seatConflictItem(b))
		}
		return api.ApproveSeatRequest409JSONResponse(conflict), nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	updated, err := qtx.SeatCharacter(ctx, db.SeatCharacterParams{ID: characterID, CampaignID: pgUUID(campaignID)})
	if err != nil {
		return nil, err
	}
	if _, err := qtx.DeleteSeatRequest(ctx, characterID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	s.logEvent(ctx, campaignID, member.UserID, "hero_seated",
		fmt.Sprintf("The DM waves %s through the door — they take a seat at the table", updated.Name))
	return api.ApproveSeatRequest204Response{}, nil
}

// DenySeatRequest turns a waiting hero away from the door (DM only).
func (s *Server) DenySeatRequest(ctx context.Context, request api.DenySeatRequestRequestObject) (api.DenySeatRequestResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	characterID := uuid.UUID(request.CharacterId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DenySeatRequest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DenySeatRequest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	req, err := s.queries.GetSeatRequest(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DenySeatRequest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if req.CampaignID != campaignID {
		return api.DenySeatRequest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if _, err := s.queries.DeleteSeatRequest(ctx, characterID); err != nil {
		return nil, err
	}
	return api.DenySeatRequest204Response{}, nil
}

// ListMySeatRequests returns the caller's heroes still waiting at a door.
func (s *Server) ListMySeatRequests(ctx context.Context, _ api.ListMySeatRequestsRequestObject) (api.ListMySeatRequestsResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListMySeatRequests401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.ListMySeatRequests(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.MySeatRequest, 0, len(rows))
	for _, r := range rows {
		out = append(out, api.MySeatRequest{
			CharacterId:  r.CharacterID,
			CampaignId:   r.CampaignID,
			CampaignName: r.CampaignName,
		})
	}
	return api.ListMySeatRequests200JSONResponse(out), nil
}
