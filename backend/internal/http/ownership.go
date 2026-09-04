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
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Ownership and the screen (#299).

A campaign has an owner and it has DMs, and until #299 they were the same
person by accident: the only write of the DM role was campaign creation, so
the creator was the one DM and nothing could ever make the two diverge. Now a
table may have several DMs, and ownership is a fact of its own:

  - A DM RUNS the table. Every door that was `requireDM` stays `requireDM`,
    and opens for all of them — quests, veils, fog, maps, the Den, the Folk.
  - The OWNER holds the doors that reshape or end the table: disbanding it,
    moving it between realms, handing it over, and appointing the DMs. The
    owner is always a DM; a DM is not always the owner.
  - Nobody removes or demotes the owner; a DM is removed only by the owner;
    a co-DM may walk away like anyone else, and the owner may not — they
    hand the table over or disband it.

Realms follow the owner. Only the owner may found campaigns on a realm or move
one onto it, so a realm's campaigns always share one owner, and a transfer has
to keep that true: a campaign ALONE on its realm takes the realm with it, atlas
and all; one sharing a realm with the owner's other campaigns steps onto fresh
ground of the new owner's, because a world cannot be split.
*/

// requireOwner is the owner's door: the person who founded the table or was
// handed it, as distinct from the DMs who run it. errForbidden for a DM who is
// not the owner, so the caller answers 403 like any other refusal; a missing
// campaign passes through as pgx.ErrNoRows for the caller's 404.
func (s *Server) requireOwner(ctx context.Context, campaignID uuid.UUID) (db.Campaign, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return db.Campaign{}, errNoAuth
	}
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return db.Campaign{}, err
	}
	if campaign.OwnerUserID != uid {
		return campaign, errForbidden
	}
	return campaign, nil
}

// memberOut renders one member as the roster does, so a role change answers
// with exactly the row the list would show — the owner mark included.
func (s *Server) memberOut(ctx context.Context, campaign db.Campaign, userID uuid.UUID) (api.Member, error) {
	rows, err := s.queries.ListMembers(ctx, campaign.ID)
	if err != nil {
		return api.Member{}, err
	}
	for _, r := range rows {
		if r.UserID == userID {
			return api.Member{
				UserId: r.UserID, Name: r.Name, Image: r.Image,
				Role: toAPIRole(r.Role), JoinedAt: r.CreatedAt.Time,
				IsOwner: r.UserID == campaign.OwnerUserID,
			}, nil
		}
	}
	return api.Member{}, pgx.ErrNoRows
}

// SetMemberRole gives a member the screen or takes it back (owner only).
func (s *Server) SetMemberRole(ctx context.Context, request api.SetMemberRoleRequestObject) (api.SetMemberRoleResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	targetID := uuid.UUID(request.UserId)
	campaign, err := s.requireOwner(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.SetMemberRole404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.SetMemberRole401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetMemberRole403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{
				Error: "only the owner appoints the DMs",
			}}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetMemberRole400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a role is required"}}, nil
	}
	role := db.MembershipRole(request.Body.Role)
	if role != db.MembershipRoleDm && role != db.MembershipRolePlayer {
		return api.SetMemberRole400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a role is dm or player"}}, nil
	}
	// The owner's own screen is not a thing to give or take: it goes with the
	// table, and the table is handed over.
	if targetID == campaign.OwnerUserID {
		return api.SetMemberRole400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the owner holds the screen — hand the table over instead",
		}}, nil
	}
	target, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: targetID, CampaignID: campaignID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetMemberRole404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if target.Role != role {
		if _, err := s.queries.AddMembership(ctx, db.AddMembershipParams{
			UserID: targetID, CampaignID: campaignID, Role: role,
		}); err != nil {
			return nil, err
		}
		name, err := s.ownerName(ctx, targetID)
		if err != nil {
			return nil, err
		}
		kind, line := "screen_given", fmt.Sprintf("%s takes up the screen as a DM", name)
		if role == db.MembershipRolePlayer {
			kind, line = "screen_taken", fmt.Sprintf("%s hands back the screen and sits with the players", name)
		}
		s.logEvent(ctx, campaignID, campaign.OwnerUserID, kind, line)
		s.publish(campaignID, live.TopicParty)
		// Their own menus change shape with the role; their account stream
		// tells them without a reload.
		s.nudge(targetID, live.TopicTable)
	}
	out, err := s.memberOut(ctx, campaign, targetID)
	if err != nil {
		return nil, err
	}
	return api.SetMemberRole200JSONResponse(out), nil
}

// TransferCampaign hands the table to another member (owner only).
func (s *Server) TransferCampaign(ctx context.Context, request api.TransferCampaignRequestObject) (api.TransferCampaignResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	campaign, err := s.requireOwner(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.TransferCampaign404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.TransferCampaign401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.TransferCampaign403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{
				Error: "only the owner may hand the table over",
			}}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.TransferCampaign400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a member to hand the table to is required"}}, nil
	}
	heirID := uuid.UUID(request.Body.UserId)
	if heirID == campaign.OwnerUserID {
		return api.TransferCampaign400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "you already hold the table"}}, nil
	}
	// They must already sit at it: a table is handed to somebody in the room.
	heir, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: heirID, CampaignID: campaignID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.TransferCampaign404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	// The heir takes the screen with the table, if they did not hold it yet;
	// the old owner keeps theirs and loses only the owner's doors.
	if heir.Role != db.MembershipRoleDm {
		if _, err := qtx.AddMembership(ctx, db.AddMembershipParams{
			UserID: heirID, CampaignID: campaignID, Role: db.MembershipRoleDm,
		}); err != nil {
			return nil, err
		}
	}
	moved, err := qtx.TransferCampaign(ctx, db.TransferCampaignParams{ID: campaignID, OwnerUserID: heirID})
	if err != nil {
		return nil, err
	}
	// The ground follows the owner. Alone on its realm, the table takes the
	// realm with it — atlas and all. Sharing one with the owner's other
	// tables, it steps onto fresh ground of the heir's: a world is not split.
	standing, err := qtx.CountCampaignsInRealm(ctx, campaign.RealmID)
	if err != nil {
		return nil, err
	}
	if standing == 1 {
		if err := qtx.TransferRealm(ctx, db.TransferRealmParams{ID: campaign.RealmID, OwnerUserID: heirID}); err != nil {
			return nil, err
		}
	} else {
		fresh, err := realmOfItsOwn(ctx, qtx, campaign.Name, heirID)
		if err != nil {
			return nil, err
		}
		if moved, err = qtx.SetCampaignRealm(ctx, db.SetCampaignRealmParams{ID: campaignID, RealmID: fresh.ID}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	giver, err := s.ownerName(ctx, campaign.OwnerUserID)
	if err != nil {
		return nil, err
	}
	taker, err := s.ownerName(ctx, heirID)
	if err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, campaign.OwnerUserID, "table_handed",
		fmt.Sprintf("%s hands the table to %s", giver, taker))
	s.publish(campaignID, live.TopicParty)
	s.nudge(heirID, live.TopicTable)
	s.nudge(campaign.OwnerUserID, live.TopicTable)

	out, err := s.campaignOut(ctx, moved, true)
	if err != nil {
		return nil, err
	}
	return api.TransferCampaign200JSONResponse(out), nil
}
