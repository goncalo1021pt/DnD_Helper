package http

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

// Authorization sentinels, translated to typed responses per endpoint.
var (
	errNoAuth    = errors.New("authentication required")
	errForbidden = errors.New("forbidden")
)

// requireMember ensures the caller is a member of the campaign and returns their
// membership. requireDM additionally enforces the DM role.
func (s *Server) requireMember(ctx context.Context, campaignID uuid.UUID) (db.Membership, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return db.Membership{}, errNoAuth
	}
	m, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: uid, CampaignID: campaignID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Membership{}, errForbidden
		}
		return db.Membership{}, err
	}
	return m, nil
}

func (s *Server) requireDM(ctx context.Context, campaignID uuid.UUID) (db.Membership, error) {
	m, err := s.requireMember(ctx, campaignID)
	if err != nil {
		return m, err
	}
	if m.Role != db.MembershipRoleDm {
		return m, errForbidden
	}
	return m, nil
}

// isDMAnywhere reports whether the user runs at least one table. Used to gate
// DM-only global content (the Monster Den) that isn't scoped to a campaign.
func (s *Server) isDMAnywhere(ctx context.Context, uid uuid.UUID) (bool, error) {
	rows, err := s.queries.ListCampaignsForUser(ctx, uid)
	if err != nil {
		return false, err
	}
	for _, r := range rows {
		if r.Role == db.MembershipRoleDm {
			return true, nil
		}
	}
	return false, nil
}

// --- handlers ---

func (s *Server) ListQuests(ctx context.Context, request api.ListQuestsRequestObject) (api.ListQuestsResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireMember(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListQuests401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListQuests403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	quests, err := s.buildQuests(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	return api.ListQuests200JSONResponse(quests), nil
}

func (s *Server) CreateQuest(ctx context.Context, request api.CreateQuestRequestObject) (api.CreateQuestResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	dm, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateQuest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateQuest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	body := request.Body
	title := ""
	if body != nil {
		title = strings.TrimSpace(body.Title)
	}
	if title == "" || len([]rune(title)) > 200 {
		return api.CreateQuest400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "title must be between 1 and 200 characters",
		}}, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	quest, err := qtx.CreateQuest(ctx, db.CreateQuestParams{
		CampaignID:  campaignID,
		Title:       title,
		Description: optStr(body.Description),
		Giver:       body.Giver,
		Location:    body.Location,
		Difficulty:  difficultyOrDefault(body.Difficulty),
		Status:      db.QuestStatusAvailable,
		CreatedBy:   dm.UserID,
	})
	if err != nil {
		return nil, err
	}
	if err := insertRewards(ctx, qtx, quest.ID, body.Rewards); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	out, err := s.buildOneQuest(ctx, quest.ID)
	if err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, dm.UserID, "quest_posted",
		fmt.Sprintf("A notice is nailed to the board: %q", quest.Title))
	metrics.QuestCreated()
	return api.CreateQuest201JSONResponse(out), nil
}

func (s *Server) UpdateQuest(ctx context.Context, request api.UpdateQuestRequestObject) (api.UpdateQuestResponseObject, error) {
	questID := uuid.UUID(request.QuestId)
	quest, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateQuest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	dm, err := s.requireDM(ctx, quest.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateQuest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateQuest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	body := request.Body
	title := ""
	if body != nil {
		title = strings.TrimSpace(body.Title)
	}
	if body == nil || title == "" || len([]rune(title)) > 200 {
		return api.UpdateQuest400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "title must be between 1 and 200 characters",
		}}, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if _, err := qtx.UpdateQuest(ctx, db.UpdateQuestParams{
		ID:          questID,
		Title:       title,
		Description: optStr(body.Description),
		Giver:       body.Giver,
		Location:    body.Location,
		Difficulty:  db.QuestDifficulty(string(body.Difficulty)),
		Status:      db.QuestStatus(string(body.Status)),
	}); err != nil {
		return nil, err
	}
	// Rewards are replaced wholesale on update.
	if err := qtx.DeleteRewardsForQuest(ctx, questID); err != nil {
		return nil, err
	}
	if err := insertRewards(ctx, qtx, questID, body.Rewards); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if quest.Status != db.QuestStatusCompleted && string(body.Status) == "completed" {
		s.logEvent(ctx, quest.CampaignID, dm.UserID, "quest_completed",
			fmt.Sprintf("The notice %q is marked complete", title))
	}

	out, err := s.buildOneQuest(ctx, questID)
	if err != nil {
		return nil, err
	}
	return api.UpdateQuest200JSONResponse(out), nil
}

func (s *Server) DeleteQuest(ctx context.Context, request api.DeleteQuestRequestObject) (api.DeleteQuestResponseObject, error) {
	questID := uuid.UUID(request.QuestId)
	quest, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteQuest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, quest.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteQuest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteQuest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteQuest(ctx, questID); err != nil {
		return nil, err
	}
	return api.DeleteQuest204Response{}, nil
}

func (s *Server) ClaimQuest(ctx context.Context, request api.ClaimQuestRequestObject) (api.ClaimQuestResponseObject, error) {
	questID := uuid.UUID(request.QuestId)
	quest, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClaimQuest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	member, err := s.requireMember(ctx, quest.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClaimQuest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClaimQuest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.ClaimQuest(ctx, db.ClaimQuestParams{QuestID: questID, UserID: member.UserID}); err != nil {
		return nil, err
	}
	metrics.QuestClaimed()
	claimerName, _ := s.ownerName(ctx, member.UserID)
	s.logEvent(ctx, quest.CampaignID, member.UserID, "quest_claimed",
		fmt.Sprintf("%s claims the notice %q", claimerName, quest.Title))
	out, err := s.buildOneQuest(ctx, questID)
	if err != nil {
		return nil, err
	}
	return api.ClaimQuest200JSONResponse(out), nil
}

func (s *Server) UnclaimQuest(ctx context.Context, request api.UnclaimQuestRequestObject) (api.UnclaimQuestResponseObject, error) {
	questID := uuid.UUID(request.QuestId)
	quest, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UnclaimQuest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	member, err := s.requireMember(ctx, quest.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UnclaimQuest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UnclaimQuest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.UnclaimQuest(ctx, db.UnclaimQuestParams{QuestID: questID, UserID: member.UserID}); err != nil {
		return nil, err
	}
	out, err := s.buildOneQuest(ctx, questID)
	if err != nil {
		return nil, err
	}
	return api.UnclaimQuest200JSONResponse(out), nil
}

