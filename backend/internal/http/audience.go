package http

import (
	"context"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Who may hear an event (#315).

The veils key by hero since #232, but an email or a webhook reaches a person,
so an audience is a list of USERS: the DMs always, and a player when the rule
holds for any hero they have seated at the table. The rule is the thing's own
veil — a quest's audience is who can see the quest — resolved here, at emit
time, by the emitter that knows it. A subscriber only ever filters down.
*/

// tableAudience walks the members: DMs in; a player in when sees holds for
// their seated heroes (nil sees = everyone).
func (s *Server) tableAudience(ctx context.Context, campaignID uuid.UUID, sees func(heroIDs []uuid.UUID) bool) ([]uuid.UUID, error) {
	members, err := s.queries.ListMembers(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	byOwner := map[uuid.UUID][]uuid.UUID{}
	if sees != nil {
		heroes, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
		if err != nil {
			return nil, err
		}
		for _, h := range heroes {
			byOwner[h.OwnerUserID] = append(byOwner[h.OwnerUserID], h.ID)
		}
	}
	out := make([]uuid.UUID, 0, len(members))
	for _, m := range members {
		if m.Role == db.MembershipRoleDm || sees == nil || sees(byOwner[m.UserID]) {
			out = append(out, m.UserID)
		}
	}
	return out, nil
}

// everyoneAt is the whole table.
func (s *Server) everyoneAt(ctx context.Context, campaignID uuid.UUID) ([]uuid.UUID, error) {
	return s.tableAudience(ctx, campaignID, nil)
}

// dmsAt is the screen alone.
func (s *Server) dmsAt(ctx context.Context, campaignID uuid.UUID) ([]uuid.UUID, error) {
	return s.tableAudience(ctx, campaignID, func([]uuid.UUID) bool { return false })
}

// ownerAndDMs is a hero's owner and the screen — what a level or XP concerns.
func (s *Server) ownerAndDMs(ctx context.Context, campaignID, owner uuid.UUID) ([]uuid.UUID, error) {
	dms, err := s.dmsAt(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	for _, id := range dms {
		if id == owner {
			return dms, nil
		}
	}
	return append(dms, owner), nil
}

// questAudience is who can see the notice, through the same veil the board
// resolves it with.
func (s *Server) questAudience(ctx context.Context, quest db.Quest) ([]uuid.UUID, error) {
	v, err := s.loadVeil(ctx, quest.CampaignID)
	if err != nil {
		return nil, err
	}
	return s.tableAudience(ctx, quest.CampaignID, func(ids []uuid.UUID) bool {
		return v.questVisibleToAny(quest, ids)
	})
}

// handoutAudience is who the prop has reached.
func (s *Server) handoutAudience(ctx context.Context, campaignID, handoutID uuid.UUID, visibleToParty bool) ([]uuid.UUID, error) {
	veil, err := s.loadHandoutVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	return s.tableAudience(ctx, campaignID, func(ids []uuid.UUID) bool {
		return veil.visibleToAny(handoutID, visibleToParty, ids)
	})
}

// newly is after minus before: the people a reveal reached for the first
// time, so revealing to a second hero does not announce to the first again.
func newly(before, after []uuid.UUID) []uuid.UUID {
	had := make(map[uuid.UUID]bool, len(before))
	for _, id := range before {
		had[id] = true
	}
	out := []uuid.UUID{}
	for _, id := range after {
		if !had[id] {
			out = append(out, id)
		}
	}
	return out
}
