package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// SetNextSession schedules (or clears) when the table gathers next (DM only).
func (s *Server) SetNextSession(ctx context.Context, request api.SetNextSessionRequestObject) (api.SetNextSessionResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetNextSession404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	dm, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetNextSession401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetNextSession403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	// Null (or an omitted field) clears the schedule.
	var ts pgtype.Timestamptz
	if request.Body != nil && request.Body.NextSessionAt != nil {
		ts = pgtype.Timestamptz{Time: *request.Body.NextSessionAt, Valid: true}
	}

	campaign, err := s.queries.SetNextSession(ctx, db.SetNextSessionParams{
		ID:            campaignID,
		NextSessionAt: ts,
	})
	if err != nil {
		return nil, err
	}
	if campaign.NextSessionAt.Valid {
		s.logEvent(ctx, campaign.ID, dm.UserID, "session_set",
			"The next gathering is set for "+campaign.NextSessionAt.Time.Format("02/01/2006 15:04"))
	}
	return api.SetNextSession200JSONResponse(toAPICampaign(campaign)), nil
}
