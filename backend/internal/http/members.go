package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// ListMembers returns everyone at the table (members only).
func (s *Server) ListMembers(ctx context.Context, request api.ListMembersRequestObject) (api.ListMembersResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ListMembers404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireMember(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListMembers401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListMembers403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.queries.ListMembers(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	members := make([]api.Member, 0, len(rows))
	for _, r := range rows {
		members = append(members, api.Member{
			UserId:   r.UserID,
			Name:     r.Name,
			Image:    r.Image,
			Role:     toAPIRole(r.Role),
			JoinedAt: r.CreatedAt.Time,
		})
	}
	return api.ListMembers200JSONResponse(members), nil
}

// KickMember removes a player from the table (DM only). DMs cannot be kicked.
func (s *Server) KickMember(ctx context.Context, request api.KickMemberRequestObject) (api.KickMemberResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	targetID := uuid.UUID(request.UserId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.KickMember404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.KickMember401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.KickMember403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	target, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: targetID, CampaignID: campaignID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.KickMember404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if target.Role == db.MembershipRoleDm {
		return api.KickMember400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the DM cannot be removed from their own table",
		}}, nil
	}

	if err := s.removeMemberTx(ctx, campaignID, targetID, false); err != nil {
		return nil, err
	}
	return api.KickMember204Response{}, nil
}

// BanMember bars a user from the campaign (DM only), kicking them first if seated.
func (s *Server) BanMember(ctx context.Context, request api.BanMemberRequestObject) (api.BanMemberResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.BanMember404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.BanMember401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.BanMember403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.BanMember400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "a userId is required",
		}}, nil
	}
	targetID := uuid.UUID(request.Body.UserId)

	// A DM can never be banned from their own table; non-members may be
	// (e.g. banning someone kicked a moment ago).
	target, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: targetID, CampaignID: campaignID})
	if err == nil && target.Role == db.MembershipRoleDm {
		return api.BanMember400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the DM cannot be banned from their own table",
		}}, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	if err := s.removeMemberTx(ctx, campaignID, targetID, true); err != nil {
		return nil, err
	}
	return api.BanMember204Response{}, nil
}

// UnbanMember lifts a ban so the invite code admits the user again (DM only).
func (s *Server) UnbanMember(ctx context.Context, request api.UnbanMemberRequestObject) (api.UnbanMemberResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UnbanMember404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UnbanMember401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UnbanMember403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	deleted, err := s.queries.UnbanUser(ctx, db.UnbanUserParams{
		CampaignID: campaignID, UserID: uuid.UUID(request.UserId),
	})
	if err != nil {
		return nil, err
	}
	if deleted == 0 {
		return api.UnbanMember404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	return api.UnbanMember204Response{}, nil
}

// ListBans returns the campaign's ban list, newest first (DM only).
func (s *Server) ListBans(ctx context.Context, request api.ListBansRequestObject) (api.ListBansResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ListBans404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListBans401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListBans403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.queries.ListBans(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	bans := make([]api.Ban, 0, len(rows))
	for _, r := range rows {
		bans = append(bans, api.Ban{
			UserId:   r.UserID,
			Name:     r.Name,
			Image:    r.Image,
			BannedAt: r.BannedAt.Time,
		})
	}
	return api.ListBans200JSONResponse(bans), nil
}

// removeMemberTx atomically removes a user's presence at a table: membership,
// seated heroes (unseated, never deleted), open quest claims, and knowledge
// pools — optionally recording a ban in the same transaction.
func (s *Server) removeMemberTx(ctx context.Context, campaignID, userID uuid.UUID, ban bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if _, err := qtx.DeleteMembership(ctx, db.DeleteMembershipParams{UserID: userID, CampaignID: campaignID}); err != nil {
		return err
	}
	if err := qtx.DeleteTableBornOfUser(ctx, db.DeleteTableBornOfUserParams{OwnerUserID: userID, CampaignID: pgUUID(campaignID)}); err != nil {
		return err
	}
	if err := qtx.UnseatCharactersOfUser(ctx, db.UnseatCharactersOfUserParams{OwnerUserID: userID, CampaignID: pgUUID(campaignID)}); err != nil {
		return err
	}
	if err := qtx.ReleaseQuestClaimsOfUser(ctx, db.ReleaseQuestClaimsOfUserParams{UserID: userID, CampaignID: campaignID}); err != nil {
		return err
	}
	if err := qtx.RemoveUserFromCampaignPools(ctx, db.RemoveUserFromCampaignPoolsParams{UserID: userID, CampaignID: campaignID}); err != nil {
		return err
	}
	if err := qtx.DeleteSeatRequestsOfUser(ctx, db.DeleteSeatRequestsOfUserParams{OwnerUserID: userID, CampaignID: campaignID}); err != nil {
		return err
	}
	if ban {
		if err := qtx.BanUser(ctx, db.BanUserParams{CampaignID: campaignID, UserID: userID}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
