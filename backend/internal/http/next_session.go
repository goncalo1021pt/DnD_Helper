package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
)

// SetNextSession schedules (or clears) when the table gathers next (DM only).
func (s *Server) SetNextSession(ctx context.Context, request api.SetNextSessionRequestObject) (api.SetNextSessionResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	before, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
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
		// Scheduled where there was none, moved where there was (#315); a
		// re-set to the same date is neither.
		payload := api.SessionEventPayload{At: campaign.NextSessionAt.Time}
		switch {
		case !before.NextSessionAt.Valid:
			aud, audErr := s.everyoneAt(ctx, campaignID)
			s.emit(ctx, campaignID, events.SessionScheduled, aud, audErr, payload)
		case !before.NextSessionAt.Time.Equal(campaign.NextSessionAt.Time):
			prev := before.NextSessionAt.Time
			payload.PreviousAt = &prev
			aud, audErr := s.everyoneAt(ctx, campaignID)
			s.emit(ctx, campaignID, events.SessionMoved, aud, audErr, payload)
		}
	}
	out, err := s.campaignOut(ctx, campaign, true)
	if err != nil {
		return nil, err
	}
	return api.SetNextSession200JSONResponse(out), nil
}
