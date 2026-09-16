package http

import (
	"context"
	"encoding/json"
	"errors"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// ListCampaignFeed reads the outbox as a feed (#315): what the catalogue
// emitted at this table, newest first, with the audience the emitter decided.
// DM only — who was told about a hidden quest is itself a spoiler.
func (s *Server) ListCampaignFeed(ctx context.Context, request api.ListCampaignFeedRequestObject) (api.ListCampaignFeedResponseObject, error) {
	campaignID := request.CampaignId
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListCampaignFeed401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListCampaignFeed403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	limit := int32(50)
	if request.Params.Limit != nil {
		limit = int32(*request.Params.Limit)
	}
	rows, err := s.queries.ListOutboxEventsByCampaign(ctx, db.ListOutboxEventsByCampaignParams{CampaignID: campaignID, Limit: limit})
	if err != nil {
		return nil, err
	}
	out := make([]api.CatalogueEvent, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPICatalogueEvent(r))
	}
	return api.ListCampaignFeed200JSONResponse(out), nil
}

func toAPICatalogueEvent(r db.ListOutboxEventsByCampaignRow) api.CatalogueEvent {
	payload := map[string]interface{}{}
	_ = json.Unmarshal(r.Payload, &payload)
	audience := make([]openapi_types.UUID, 0, len(r.Audience))
	for _, id := range r.Audience {
		audience = append(audience, openapi_types.UUID(id))
	}
	e := api.CatalogueEvent{
		Id:         openapi_types.UUID(r.ID),
		Name:       api.EventName(r.Name),
		At:         r.CreatedAt.Time,
		CampaignId: openapi_types.UUID(r.CampaignID),
		Audience:   &audience,
		Payload:    payload,
	}
	if r.ActorUserID.Valid {
		name := ""
		if r.ActorName != nil {
			name = *r.ActorName
		}
		e.Actor = &api.EventActor{Id: openapi_types.UUID(r.ActorUserID.Bytes), Name: name}
	}
	return e
}
