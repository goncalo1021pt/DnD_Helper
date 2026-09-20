package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
	"github.com/goncalo1021pt/questboard/backend/internal/notify"
	"github.com/goncalo1021pt/questboard/backend/internal/webhooks"
)

/*
Notifications that reach you outside the app (#316).

Three doors. A person's own: which events are emailed to them, and a table
they have muted. A table's: the Discord channel a DM hangs on it — a webhook
with no owner that posts only what the whole table may hear. And the way
out: the unsubscribe link every notice carries, which needs no session
because the token in it is the proof.
*/

func (s *Server) GetNotificationSettings(ctx context.Context, _ api.GetNotificationSettingsRequestObject) (api.GetNotificationSettingsResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.GetNotificationSettings401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	out, err := s.notificationSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.GetNotificationSettings200JSONResponse(out), nil
}

func (s *Server) SetNotificationSettings(ctx context.Context, request api.SetNotificationSettingsRequestObject) (api.SetNotificationSettingsResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.SetNotificationSettings401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if request.Body == nil {
		return api.SetNotificationSettings400JSONResponse{BadRequestJSONResponse: badRequest("a body is required")}, nil
	}
	names, bad := eventNames(request.Body.EmailEvents)
	if bad != "" {
		return api.SetNotificationSettings400JSONResponse{BadRequestJSONResponse: badRequest("unknown event " + bad)}, nil
	}
	for _, n := range names {
		if !notify.Offered(events.Name(n)) {
			return api.SetNotificationSettings400JSONResponse{BadRequestJSONResponse: badRequest(n + " is not offered by email")}, nil
		}
	}
	// An empty list is a choice — none — and must reach the column as one,
	// never as the NULL that means "the defaults".
	if err := s.queries.SetEmailEvents(ctx, db.SetEmailEventsParams{ID: uid, EmailEvents: names}); err != nil {
		return nil, err
	}
	out, err := s.notificationSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.SetNotificationSettings200JSONResponse(out), nil
}

func (s *Server) notificationSettings(ctx context.Context, uid uuid.UUID) (api.NotificationSettings, error) {
	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return api.NotificationSettings{}, err
	}
	chosen, err := s.queries.GetEmailEvents(ctx, uid)
	if err != nil {
		return api.NotificationSettings{}, err
	}
	names := []api.EventName{}
	for _, n := range events.All {
		if notify.Wants(chosen.EmailEvents, chosen.UseDefaults, n) {
			names = append(names, api.EventName(n))
		}
	}
	muted, err := s.queries.ListMutedCampaigns(ctx, uid)
	if err != nil {
		return api.NotificationSettings{}, err
	}
	mutedIDs := make([]openapi_types.UUID, 0, len(muted))
	for _, id := range muted {
		mutedIDs = append(mutedIDs, openapi_types.UUID(id))
	}
	out := api.NotificationSettings{EmailEvents: names, EmailVerified: user.EmailVerified, MutedCampaignIds: mutedIDs}
	if user.Email != nil && *user.Email != "" {
		out.EmailAddress = user.Email
	}
	return out, nil
}

// eventNames reads a list off the wire: from the catalogue, deduplicated,
// order kept. The second value names the first stranger.
func eventNames(in []api.EventName) ([]string, string) {
	known := map[string]bool{}
	for _, n := range events.All {
		known[string(n)] = true
	}
	seen := map[string]bool{}
	names := make([]string, 0, len(in))
	for _, raw := range in {
		n := string(raw)
		if !known[n] {
			return nil, n
		}
		if !seen[n] {
			seen[n] = true
			names = append(names, n)
		}
	}
	return names, ""
}

// SetCampaignMute silences one table for the caller: no email about it. A
// fact about their membership, so any member may set it and leaving drops it.
func (s *Server) SetCampaignMute(ctx context.Context, request api.SetCampaignMuteRequestObject) (api.SetCampaignMuteResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetCampaignMute401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetCampaignMute403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	muted := request.Body != nil && request.Body.Muted
	if _, err := s.queries.SetMembershipMuted(ctx, db.SetMembershipMutedParams{UserID: member.UserID, CampaignID: campaignID, Muted: muted}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetCampaignMute403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	return api.SetCampaignMute204Response{}, nil
}

// SetTableChannel hangs the table's Discord channel (DM only). Setting it
// again replaces the URL and the names and gives a disabled one another
// chance, since a DM pasting a fresh URL means it.
func (s *Server) SetTableChannel(ctx context.Context, request api.SetTableChannelRequestObject) (api.SetTableChannelResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetTableChannel401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetTableChannel403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if s.webhooks == nil {
		return api.SetTableChannel400JSONResponse{BadRequestJSONResponse: badRequest("webhooks are not enabled on this server")}, nil
	}
	if request.Body == nil {
		return api.SetTableChannel400JSONResponse{BadRequestJSONResponse: badRequest("a URL is required")}, nil
	}
	rawURL := strings.TrimSpace(request.Body.Url)
	if err := s.webhooks.Guard().ValidateURL(rawURL); err != nil {
		return api.SetTableChannel400JSONResponse{BadRequestJSONResponse: badRequest(err.Error())}, nil
	}
	if len([]rune(rawURL)) > 2048 {
		return api.SetTableChannel400JSONResponse{BadRequestJSONResponse: badRequest("the URL is too long")}, nil
	}
	names, bad := eventNames(request.Body.Events)
	if bad != "" {
		return api.SetTableChannel400JSONResponse{BadRequestJSONResponse: badRequest("unknown event " + bad)}, nil
	}
	if _, err := s.queries.UpsertTableChannel(ctx, db.UpsertTableChannelParams{
		Url: rawURL, Secret: webhooks.NewSecret(), Events: names, CampaignID: pgtype.UUID{Bytes: campaignID, Valid: true},
	}); err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, member.UserID, "table_rules", "The DM hangs a herald's horn on the table — its channel hears what everyone hears")
	c, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out, err := s.campaignOut(ctx, c, true)
	if err != nil {
		return nil, err
	}
	return api.SetTableChannel200JSONResponse(out), nil
}

func (s *Server) DeleteTableChannel(ctx context.Context, request api.DeleteTableChannelRequestObject) (api.DeleteTableChannelResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteTableChannel401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteTableChannel403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	n, err := s.queries.DeleteTableChannel(ctx, pgtype.UUID{Bytes: campaignID, Valid: true})
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return api.DeleteTableChannel404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	c, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out, err := s.campaignOut(ctx, c, true)
	if err != nil {
		return nil, err
	}
	return api.DeleteTableChannel200JSONResponse(out), nil
}

func (s *Server) PingTableChannel(ctx context.Context, request api.PingTableChannelRequestObject) (api.PingTableChannelResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.PingTableChannel401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.PingTableChannel403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	row, err := s.queries.GetTableChannel(ctx, pgtype.UUID{Bytes: campaignID, Valid: true})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.PingTableChannel404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if s.webhooks == nil {
		return api.PingTableChannel404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	deliveryID, err := s.webhooks.Ping(ctx, row.ID, row.Format)
	if err != nil {
		return nil, err
	}
	return api.PingTableChannel202JSONResponse{DeliveryId: openapi_types.UUID(deliveryID)}, nil
}

// Unsubscribe is the door at the bottom of every notice, mounted by hand
// outside the contract because it needs no session: the token is the proof.
// A mail client POSTs to it with `List-Unsubscribe=One-Click` (RFC 8058)
// and it acts; a browser GETs it and is sent to the page that asks first,
// since a link scanner follows what it finds and must not unsubscribe
// anyone by looking.
func (s *Server) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if r.Method == http.MethodGet {
		http.Redirect(w, r, "/unsubscribe?token="+url.QueryEscape(token), http.StatusFound)
		return
	}
	if token == "" && strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var body struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err == nil {
			token = body.Token
		}
	}
	if s.notify == nil {
		http.Error(w, "notifications are not enabled on this server", http.StatusNotFound)
		return
	}
	if err := s.notify.Unsubscribe(r.Context(), token); err != nil {
		if errors.Is(err, notify.ErrBadToken) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
