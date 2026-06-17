package http

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// Server implements the generated api.StrictServerInterface.
type Server struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func NewServer(pool *pgxpool.Pool) *Server {
	return &Server{pool: pool, queries: db.New(pool)}
}

// GetHealth reports liveness and database reachability.
func (s *Server) GetHealth(ctx context.Context, _ api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	if err := s.pool.Ping(ctx); err != nil {
		return api.GetHealth503JSONResponse{Status: api.Degraded}, nil
	}
	return api.GetHealth200JSONResponse{Status: api.Ok}, nil
}

// GetCurrentUser returns the authenticated user and their campaign memberships.
func (s *Server) GetCurrentUser(ctx context.Context, _ api.GetCurrentUserRequestObject) (api.GetCurrentUserResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.GetCurrentUser401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}

	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return api.GetCurrentUser401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	memberships, err := s.listMemberships(ctx, uid)
	if err != nil {
		return nil, err
	}

	return api.GetCurrentUser200JSONResponse{
		User:      toAPIUser(user),
		Campaigns: memberships,
	}, nil
}

// ListCampaigns returns the campaigns the caller belongs to.
func (s *Server) ListCampaigns(ctx context.Context, _ api.ListCampaignsRequestObject) (api.ListCampaignsResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListCampaigns401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	memberships, err := s.listMemberships(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.ListCampaigns200JSONResponse(memberships), nil
}

// CreateCampaign creates a campaign and makes the caller its DM.
func (s *Server) CreateCampaign(ctx context.Context, request api.CreateCampaignRequestObject) (api.CreateCampaignResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.CreateCampaign401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}

	name := ""
	if request.Body != nil {
		name = strings.TrimSpace(request.Body.Name)
	}
	if name == "" || len([]rune(name)) > 120 {
		return api.CreateCampaign400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "name must be between 1 and 120 characters",
		}}, nil
	}

	// Creating the campaign and the owner's DM membership must be atomic.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	campaign, err := qtx.CreateCampaign(ctx, db.CreateCampaignParams{Name: name, OwnerUserID: uid})
	if err != nil {
		return nil, err
	}
	if _, err := qtx.AddMembership(ctx, db.AddMembershipParams{
		UserID:     uid,
		CampaignID: campaign.ID,
		Role:       db.MembershipRoleDm,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return api.CreateCampaign201JSONResponse(toAPICampaign(campaign)), nil
}

func (s *Server) listMemberships(ctx context.Context, uid uuid.UUID) ([]api.CampaignMembership, error) {
	rows, err := s.queries.ListCampaignsForUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.CampaignMembership, 0, len(rows))
	for _, row := range rows {
		out = append(out, api.CampaignMembership{
			Campaign: api.Campaign{
				Id:          row.ID,
				Name:        row.Name,
				OwnerUserId: row.OwnerUserID,
				CreatedAt:   row.CreatedAt.Time,
			},
			Role: toAPIRole(row.Role),
		})
	}
	return out, nil
}

func toAPIUser(u db.User) api.User {
	return api.User{
		Id:    u.ID,
		Name:  u.Name,
		Email: u.Email,
		Image: u.Image,
	}
}

func toAPICampaign(c db.Campaign) api.Campaign {
	return api.Campaign{
		Id:          c.ID,
		Name:        c.Name,
		OwnerUserId: c.OwnerUserID,
		CreatedAt:   c.CreatedAt.Time,
	}
}

func toAPIRole(r db.MembershipRole) api.Role {
	if r == db.MembershipRoleDm {
		return api.Dm
	}
	return api.Player
}

func unauthorized() api.UnauthorizedJSONResponse {
	return api.UnauthorizedJSONResponse{Error: "authentication required"}
}
