package http

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
	"github.com/goncalo1021pt/questboard/backend/internal/webhooks"
)

/*
Webhooks (#295): a person's standing order to be told, at a URL of their
choosing, when chosen events happen.

A subscription hears only what its owner could see — the audience the emitter
decided (#315) is the only delivery gate — and one born of an API token hears
no more than the token could read: it records the token's scopes and its
table restriction, and creation refuses a name the token could not have read.
*/

// deliveriesShown is the length of the log a person reads.
const deliveriesShown = 20

func (s *Server) ListWebhooks(ctx context.Context, _ api.ListWebhooksRequestObject) (api.ListWebhooksResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListWebhooks401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.ListWebhooksByUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.Webhook, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPIWebhook(db.GetWebhookForUserRow(r)))
	}
	return api.ListWebhooks200JSONResponse(out), nil
}

func (s *Server) CreateWebhook(ctx context.Context, request api.CreateWebhookRequestObject) (api.CreateWebhookResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.CreateWebhook401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if s.webhooks == nil {
		return api.CreateWebhook400JSONResponse{BadRequestJSONResponse: badRequest("webhooks are not enabled on this server")}, nil
	}
	if request.Body == nil {
		return api.CreateWebhook400JSONResponse{BadRequestJSONResponse: badRequest("a URL is required")}, nil
	}
	in := *request.Body

	rawURL := strings.TrimSpace(in.Url)
	if err := s.webhooks.Guard().ValidateURL(rawURL); err != nil {
		return api.CreateWebhook400JSONResponse{BadRequestJSONResponse: badRequest(err.Error())}, nil
	}
	if len([]rune(rawURL)) > 2048 {
		return api.CreateWebhook400JSONResponse{BadRequestJSONResponse: badRequest("the URL is too long")}, nil
	}

	// Born of a token? Then it may hear no more than the token could read.
	grant, _ := auth.GrantOf(ctx)
	var capScopes []string
	var held auth.Scopes
	if grant.Kind == auth.GrantToken {
		held = grant.Scopes
		for _, sc := range grant.Scopes {
			capScopes = append(capScopes, string(sc))
		}
		if capScopes == nil {
			capScopes = []string{}
		}
	}

	// The names: from the catalogue, deduplicated; empty means every one.
	known := map[string]bool{}
	for _, n := range events.All {
		known[string(n)] = true
	}
	seen := map[string]bool{}
	names := make([]string, 0, len(in.Events))
	for _, raw := range in.Events {
		n := string(raw)
		if !known[n] {
			return api.CreateWebhook400JSONResponse{BadRequestJSONResponse: badRequest("unknown event " + n)}, nil
		}
		if grant.Kind == auth.GrantToken {
			if need := webhooks.ReadScopeOf(events.Name(n)); !held.Holds(need) {
				return api.CreateWebhook403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{
					Error: "this token cannot hear " + n + ": it lacks " + string(need),
				}}, nil
			}
		}
		if !seen[n] {
			seen[n] = true
			names = append(names, n)
		}
	}

	// The one table, if any — the token's own, when it was minted for one.
	var campaign pgtype.UUID
	var campaignName *string
	if in.CampaignId != nil {
		id := uuid.UUID(*in.CampaignId)
		if grant.Kind == auth.GrantToken && grant.Campaign != nil && *grant.Campaign != id {
			return api.CreateWebhook404JSONResponse{Error: "not found"}, nil
		}
		if _, err := s.requireMember(ctx, id); err != nil {
			if errors.Is(err, errForbidden) {
				return api.CreateWebhook404JSONResponse{Error: "not found"}, nil
			}
			return nil, err
		}
		c, err := s.queries.GetCampaign(ctx, id)
		if err != nil {
			return nil, err
		}
		campaign = pgtype.UUID{Bytes: id, Valid: true}
		campaignName = &c.Name
	} else if grant.Kind == auth.GrantToken && grant.Campaign != nil {
		if c, err := s.queries.GetCampaign(ctx, *grant.Campaign); err == nil {
			campaign = pgtype.UUID{Bytes: c.ID, Valid: true}
			campaignName = &c.Name
		}
	}

	count, err := s.queries.CountWebhooksByUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	if count >= webhooks.MaxPerUser {
		return api.CreateWebhook400JSONResponse{BadRequestJSONResponse: badRequest("too many webhooks — remove one first")}, nil
	}

	secret := webhooks.NewSecret()
	row, err := s.queries.CreateWebhook(ctx, db.CreateWebhookParams{
		UserID: uid, Url: rawURL, Secret: secret, Events: names, CampaignID: campaign, Scopes: capScopes,
	})
	if err != nil {
		return nil, err
	}
	full := db.GetWebhookForUserRow{
		ID: row.ID, UserID: row.UserID, Url: row.Url, Secret: row.Secret, Events: row.Events,
		CampaignID: row.CampaignID, Scopes: row.Scopes, CreatedAt: row.CreatedAt, Failures: row.Failures,
		DisabledAt: row.DisabledAt, DisabledReason: row.DisabledReason, CampaignName: campaignName,
	}
	return api.CreateWebhook201JSONResponse{Webhook: toAPIWebhook(full), Secret: secret}, nil
}

func (s *Server) DeleteWebhook(ctx context.Context, request api.DeleteWebhookRequestObject) (api.DeleteWebhookResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.DeleteWebhook401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if _, err := s.queries.DeleteWebhook(ctx, db.DeleteWebhookParams{ID: uuid.UUID(request.WebhookId), UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteWebhook404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	return api.DeleteWebhook204Response{}, nil
}

func (s *Server) EnableWebhook(ctx context.Context, request api.EnableWebhookRequestObject) (api.EnableWebhookResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.EnableWebhook401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	id := uuid.UUID(request.WebhookId)
	if _, err := s.queries.GetWebhookForUser(ctx, db.GetWebhookForUserParams{ID: id, UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.EnableWebhook404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if err := s.queries.EnableWebhook(ctx, db.EnableWebhookParams{ID: id, UserID: uid}); err != nil {
		return nil, err
	}
	row, err := s.queries.GetWebhookForUser(ctx, db.GetWebhookForUserParams{ID: id, UserID: uid})
	if err != nil {
		return nil, err
	}
	return api.EnableWebhook200JSONResponse(toAPIWebhook(row)), nil
}

func (s *Server) PingWebhook(ctx context.Context, request api.PingWebhookRequestObject) (api.PingWebhookResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.PingWebhook401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	id := uuid.UUID(request.WebhookId)
	if _, err := s.queries.GetWebhookForUser(ctx, db.GetWebhookForUserParams{ID: id, UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.PingWebhook404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if s.webhooks == nil {
		return api.PingWebhook404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	deliveryID, err := s.webhooks.Ping(ctx, id)
	if err != nil {
		return nil, err
	}
	return api.PingWebhook202JSONResponse{DeliveryId: openapi_types.UUID(deliveryID)}, nil
}

func (s *Server) ListWebhookDeliveries(ctx context.Context, request api.ListWebhookDeliveriesRequestObject) (api.ListWebhookDeliveriesResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListWebhookDeliveries401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	id := uuid.UUID(request.WebhookId)
	if _, err := s.queries.GetWebhookForUser(ctx, db.GetWebhookForUserParams{ID: id, UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ListWebhookDeliveries404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	rows, err := s.queries.ListWebhookDeliveries(ctx, db.ListWebhookDeliveriesParams{WebhookID: id, Limit: deliveriesShown})
	if err != nil {
		return nil, err
	}
	out := make([]api.WebhookDelivery, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPIWebhookDelivery(r))
	}
	return api.ListWebhookDeliveries200JSONResponse(out), nil
}

func toAPIWebhook(r db.GetWebhookForUserRow) api.Webhook {
	names := make([]api.EventName, 0, len(r.Events))
	for _, e := range r.Events {
		names = append(names, api.EventName(e))
	}
	out := api.Webhook{
		Id:        openapi_types.UUID(r.ID),
		Url:       r.Url,
		Events:    names,
		CreatedAt: r.CreatedAt.Time,
		Failures:  int(r.Failures),
	}
	if r.CampaignID.Valid {
		id := openapi_types.UUID(r.CampaignID.Bytes)
		out.CampaignId = &id
		out.CampaignName = r.CampaignName
	}
	if r.Scopes != nil {
		scopes := make([]api.TokenScope, 0, len(r.Scopes))
		for _, sc := range r.Scopes {
			scopes = append(scopes, api.TokenScope(sc))
		}
		out.Scopes = &scopes
	}
	if r.LastDeliveredAt.Valid {
		t := r.LastDeliveredAt.Time
		out.LastDeliveredAt = &t
	}
	if r.DisabledAt.Valid {
		t := r.DisabledAt.Time
		out.DisabledAt = &t
		out.DisabledReason = r.DisabledReason
	}
	return out
}

func toAPIWebhookDelivery(r db.WebhookDelivery) api.WebhookDelivery {
	body := map[string]interface{}{}
	_ = json.Unmarshal(r.Body, &body)
	out := api.WebhookDelivery{
		Id:        openapi_types.UUID(r.ID),
		Name:      r.Name,
		Attempts:  int(r.Attempts),
		CreatedAt: r.CreatedAt.Time,
		Body:      body,
		LastError: r.LastError,
	}
	if r.LastStatus != nil {
		st := int(*r.LastStatus)
		out.LastStatus = &st
	}
	if r.DeliveredAt.Valid {
		t := r.DeliveredAt.Time
		out.DeliveredAt = &t
	}
	if r.DeadAt.Valid {
		t := r.DeadAt.Time
		out.DeadAt = &t
	}
	if !r.DeliveredAt.Valid && !r.DeadAt.Valid && r.NextAttemptAt.Valid {
		t := r.NextAttemptAt.Time
		out.NextAttemptAt = &t
	}
	return out
}
