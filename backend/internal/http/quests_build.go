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
)

func forbidden() api.ForbiddenJSONResponse { return api.ForbiddenJSONResponse{Error: "not allowed"} }
func notFound() api.NotFoundJSONResponse   { return api.NotFoundJSONResponse{Error: "not found"} }

func optStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// nameOr prefers a linked location's name over the legacy freeform text, so the
// two never disagree about where a notice hangs.
func nameOr(name, fallback *string) *string {
	if name != nil {
		return name
	}
	return fallback
}

// resolveCampaignLocation validates that a requested location belongs to the
// campaign and returns the column value plus its display name. A nil request
// pins the thing nowhere; an unknown id comes back invalid for the caller to
// reject. Quests hang off the place tree, and so do prepared encounters.
func (s *Server) resolveCampaignLocation(ctx context.Context, campaignID uuid.UUID, locationID *uuid.UUID) (pgtype.UUID, *string, error) {
	if locationID == nil {
		return pgtype.UUID{}, nil, nil
	}
	loc, err := s.queries.GetLocation(ctx, *locationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgtype.UUID{}, nil, nil
		}
		return pgtype.UUID{}, nil, err
	}
	if loc.CampaignID != campaignID {
		return pgtype.UUID{}, nil, nil
	}
	name := loc.Name
	return pgUUID(loc.ID), &name, nil
}

// questVisibleToMember reports whether any hero this member has seated at the
// campaign can see the notice.
func (s *Server) questVisibleToMember(ctx context.Context, quest db.Quest, userID uuid.UUID) (bool, error) {
	v, err := s.loadVeil(ctx, quest.CampaignID)
	if err != nil {
		return false, err
	}
	charIDs, err := s.seatedCharacterIDs(ctx, quest.CampaignID, userID)
	if err != nil {
		return false, err
	}
	return v.questVisibleToAny(quest, charIDs), nil
}

func difficultyOrDefault(d *api.QuestDifficulty) db.QuestDifficulty {
	if d == nil {
		return db.QuestDifficultyMedium
	}
	return db.QuestDifficulty(string(*d))
}

// insertRewards writes the reward rows for a quest, skipping blank labels.
func insertRewards(ctx context.Context, q *db.Queries, questID uuid.UUID, rewards *[]api.RewardInput) error {
	if rewards == nil {
		return nil
	}
	for _, r := range *rewards {
		label := strings.TrimSpace(r.Label)
		if label == "" {
			continue
		}
		if _, err := q.AddReward(ctx, db.AddRewardParams{
			QuestID: questID,
			Type:    db.RewardType(string(r.Type)),
			Label:   label,
			Value:   r.Value,
		}); err != nil {
			return err
		}
	}
	return nil
}

// buildQuests assembles the board for a campaign (quests + rewards + claims) in
// a fixed number of queries, marking which quests the caller has claimed.
//
// The board is filtered by the veil: the DM sees every notice plus its
// visibility state, a player sees only what is unveiled to one of their heroes.
func (s *Server) buildQuests(ctx context.Context, campaignID uuid.UUID) ([]api.Quest, error) {
	uid, _ := auth.UserID(ctx)

	isDM := false
	if m, err := s.requireMember(ctx, campaignID); err == nil {
		isDM = m.Role == db.MembershipRoleDm
	}
	var charIDs []uuid.UUID
	if !isDM {
		var err error
		charIDs, err = s.seatedCharacterIDs(ctx, campaignID, uid)
		if err != nil {
			return nil, err
		}
	}
	v, err := s.loadVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}

	quests, err := s.queries.ListQuestsByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	rewards, err := s.queries.ListRewardsByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	claims, err := s.queries.ListClaimsByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}

	rewardsByQuest := map[uuid.UUID][]api.QuestReward{}
	for _, r := range rewards {
		rewardsByQuest[r.QuestID] = append(rewardsByQuest[r.QuestID], api.QuestReward{
			Id:    r.ID,
			Type:  api.RewardType(string(r.Type)),
			Label: r.Label,
			Value: r.Value,
		})
	}

	claimsByQuest := map[uuid.UUID][]api.QuestClaim{}
	claimedByMe := map[uuid.UUID]bool{}
	for _, c := range claims {
		claimsByQuest[c.QuestID] = append(claimsByQuest[c.QuestID], api.QuestClaim{
			UserId:    c.UserID,
			UserName:  c.UserName,
			ClaimedAt: c.ClaimedAt.Time,
		})
		if c.UserID == uid {
			claimedByMe[c.QuestID] = true
		}
	}

	out := make([]api.Quest, 0, len(quests))
	for _, q := range quests {
		if !isDM && !v.questVisibleToAny(q, charIDs) {
			continue
		}
		quest := toAPIQuest(q, rewardsByQuest[q.ID], claimsByQuest[q.ID], claimedByMe[q.ID])
		if loc, ok := v.locations[q.LocationID.Bytes]; ok && q.LocationID.Valid {
			// The linked place is the display name players see, so renaming a
			// city renames it on every notice hanging there.
			name := loc.Name
			quest.Location = &name
			id := loc.ID
			quest.LocationId = &id
		}
		if isDM {
			visible := q.VisibleToParty
			quest.VisibleToParty = &visible
			overrides := v.overridesFor(v.questOverrides[q.ID])
			quest.Visibility = &overrides
			// A notice can be posted and still dark because its city is veiled.
			hidden := q.LocationID.Valid && !v.locationVisibleTo(q.LocationID.Bytes, uuid.Nil)
			quest.HiddenByLocation = &hidden
		}
		out = append(out, quest)
	}
	return out, nil
}

// buildOneQuest returns a single assembled quest by id.
func (s *Server) buildOneQuest(ctx context.Context, questID uuid.UUID) (api.Quest, error) {
	q, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		return api.Quest{}, err
	}
	all, err := s.buildQuests(ctx, q.CampaignID)
	if err != nil {
		return api.Quest{}, err
	}
	for _, quest := range all {
		if quest.Id == questID {
			return quest, nil
		}
	}
	return api.Quest{}, errors.New("quest disappeared during assembly")
}

func toAPIQuest(q db.Quest, rewards []api.QuestReward, claims []api.QuestClaim, claimedByMe bool) api.Quest {
	if rewards == nil {
		rewards = []api.QuestReward{}
	}
	if claims == nil {
		claims = []api.QuestClaim{}
	}
	return api.Quest{
		Id:          q.ID,
		CampaignId:  q.CampaignID,
		Title:       q.Title,
		Description: q.Description,
		Giver:       q.Giver,
		Location:    q.Location,
		Difficulty:  api.QuestDifficulty(string(q.Difficulty)),
		Status:      api.QuestStatus(string(q.Status)),
		CreatedAt:   q.CreatedAt.Time,
		Rewards:     rewards,
		Claims:      claims,
		ClaimedByMe: claimedByMe,
	}
}
