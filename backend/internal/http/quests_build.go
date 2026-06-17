package http

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

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

// buildQuests assembles the full board for a campaign (quests + rewards + claims)
// in a fixed number of queries, marking which quests the caller has claimed.
func (s *Server) buildQuests(ctx context.Context, campaignID uuid.UUID) ([]api.Quest, error) {
	uid, _ := auth.UserID(ctx)

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
		out = append(out, toAPIQuest(q, rewardsByQuest[q.ID], claimsByQuest[q.ID], claimedByMe[q.ID]))
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
