package http

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Handouts: the letter, the torn map corner, the sigil burned into the door.

Props follow the same veil as places and notices, and the same split as maps —
metadata rides the generated API, the bytes stream through a hand-rolled route
so the spec stays JSON-only. The one rule worth stating twice: a player's copy
of the world contains no veiled handout at all. Not a locked one, not a greyed
one — the listing omits it, the chronicle line naming it is filtered out, and
the image route refuses it. A prop the party has not been shown should not be
discoverable by reading the network tab.
*/

// handoutRow is the shared shape of every no-image handouts query row.
type handoutRow struct {
	ID             uuid.UUID
	CampaignID     uuid.UUID
	Title          string
	Caption        string
	ContentType    string
	Width          int32
	Height         int32
	VisibleToParty bool
	CreatedAt      pgtype.Timestamptz
}

// toAPIHandout renders one handout. The DM's copy carries the veil state; a
// player's carries nothing about who else can see it.
func toAPIHandout(h handoutRow, forDM bool, overrides []api.VisibilityOverride) api.Handout {
	out := api.Handout{
		Id:         h.ID,
		CampaignId: h.CampaignID,
		Title:      h.Title,
		Caption:    h.Caption,
		Width:      int(h.Width),
		Height:     int(h.Height),
		CreatedAt:  h.CreatedAt.Time,
	}
	if forDM {
		visible := h.VisibleToParty
		out.VisibleToParty = &visible
		out.Visibility = &overrides
	}
	return out
}

// handoutMeta resolves a handout to its campaign, translating a missing row to
// pgx.ErrNoRows for the caller's 404 branch.
func (s *Server) handoutMeta(ctx context.Context, handoutID uuid.UUID) (db.GetHandoutMetaRow, error) {
	return s.queries.GetHandoutMeta(ctx, handoutID)
}

// buildOneHandout re-reads a handout with its veil, for the response to a
// change the DM just made.
func (s *Server) buildOneHandout(ctx context.Context, handoutID uuid.UUID) (api.Handout, error) {
	row, err := s.queries.GetHandoutMeta(ctx, handoutID)
	if err != nil {
		return api.Handout{}, err
	}
	rows, err := s.queries.ListHandoutVisibility(ctx, handoutID)
	if err != nil {
		return api.Handout{}, err
	}
	overrides := make([]api.VisibilityOverride, 0, len(rows))
	for _, r := range rows {
		overrides = append(overrides, api.VisibilityOverride{
			CharacterId:   r.CharacterID,
			CharacterName: r.CharacterName,
			Visible:       r.Visible,
		})
	}
	sortOverrides(overrides)
	return toAPIHandout(handoutRow(row), true, overrides), nil
}

// ListHandouts returns the campaign's handouts — all of them for the DM, only
// the revealed ones for a player.
func (s *Server) ListHandouts(ctx context.Context, request api.ListHandoutsRequestObject) (api.ListHandoutsResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListHandouts401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListHandouts403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	rows, err := s.queries.ListHandoutsByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	veil, err := s.loadHandoutVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	isDM := member.Role == db.MembershipRoleDm

	var charIDs []uuid.UUID
	if !isDM {
		charIDs, err = s.seatedCharacterIDs(ctx, campaignID, member.UserID)
		if err != nil {
			return nil, err
		}
	}

	out := make([]api.Handout, 0, len(rows))
	for _, r := range rows {
		if !isDM && !veil.visibleToAny(r.ID, r.VisibleToParty, charIDs) {
			continue
		}
		out = append(out, toAPIHandout(handoutRow(r), isDM, veil.overridesFor(r.ID)))
	}
	return api.ListHandouts200JSONResponse(out), nil
}

// CreateHandout brings a prop to the table (DM only). It arrives veiled unless
// the DM says otherwise — the reveal is the moment, and it belongs at the table.
func (s *Server) CreateHandout(ctx context.Context, request api.CreateHandoutRequestObject) (api.CreateHandoutResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateHandout401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateHandout403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.CreateHandoutResponseObject, error) {
		return api.CreateHandout400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a handout needs a title and an image")
	}
	title := strings.TrimSpace(request.Body.Title)
	if title == "" {
		return badRequest("the handout needs a title")
	}
	caption := ""
	if request.Body.Caption != nil {
		caption = strings.TrimSpace(*request.Body.Caption)
	}
	// Same decoder as the atlas: base64 in, sniffed JPEG/PNG, measured.
	data, contentType, w, h, err := decodeMapImage(request.Body.ImageBase64)
	if err != nil {
		return badRequest(err.Error())
	}
	visible := request.Body.VisibleToParty != nil && *request.Body.VisibleToParty

	row, err := s.queries.CreateHandout(ctx, db.CreateHandoutParams{
		CampaignID:     campaignID,
		Title:          title,
		Caption:        caption,
		Image:          data,
		ContentType:    contentType,
		Width:          int32(w),
		Height:         int32(h),
		VisibleToParty: visible,
	})
	if err != nil {
		return nil, err
	}
	if visible {
		s.handOver(ctx, campaignID, member.UserID, row.ID, title, caption)
	}
	return api.CreateHandout201JSONResponse(
		toAPIHandout(handoutRow(row), true, []api.VisibilityOverride{}),
	), nil
}

// handOver writes the chronicle line that puts a prop in the party's hands —
// once. A later reveal to one more hero lights up the line already there, so
// this checks before writing rather than stacking duplicates on a feed.
func (s *Server) handOver(ctx context.Context, campaignID, actorID, handoutID uuid.UUID, title, caption string) {
	if _, err := s.queries.GetHandoutEvent(ctx, pgUUID(handoutID)); err == nil {
		return // already handed over once; the existing line is theirs to find
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return // a read that failed is not grounds for a second line
	}
	line := fmt.Sprintf("The DM hands the table %s", title)
	if caption != "" {
		line += " — " + caption
	}
	if _, err := s.queries.AddHandoutEvent(ctx, db.AddHandoutEventParams{
		CampaignID:  campaignID,
		ActorUserID: pgUUID(actorID),
		Message:     line,
		HandoutID:   pgUUID(handoutID),
	}); err != nil {
		return
	}
	s.publish(campaignID, live.TopicChronicle)
}

// UpdateHandout retitles or recaptions a prop (DM only).
func (s *Server) UpdateHandout(ctx context.Context, request api.UpdateHandoutRequestObject) (api.UpdateHandoutResponseObject, error) {
	handoutID := uuid.UUID(request.HandoutId)
	meta, err := s.handoutMeta(ctx, handoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateHandout404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateHandout401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateHandout403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil || strings.TrimSpace(request.Body.Title) == "" {
		return api.UpdateHandout400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the handout needs a title",
		}}, nil
	}
	if _, err := s.queries.UpdateHandout(ctx, db.UpdateHandoutParams{
		ID:      handoutID,
		Title:   strings.TrimSpace(request.Body.Title),
		Caption: strings.TrimSpace(request.Body.Caption),
	}); err != nil {
		return nil, err
	}
	out, err := s.buildOneHandout(ctx, handoutID)
	if err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicChronicle)
	return api.UpdateHandout200JSONResponse(out), nil
}

// DeleteHandout takes a prop back off the table. Its chronicle line goes with
// it (ON DELETE CASCADE) — a line pointing at nothing is a line about nothing.
func (s *Server) DeleteHandout(ctx context.Context, request api.DeleteHandoutRequestObject) (api.DeleteHandoutResponseObject, error) {
	handoutID := uuid.UUID(request.HandoutId)
	meta, err := s.handoutMeta(ctx, handoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteHandout404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteHandout401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteHandout403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if _, err := s.queries.DeleteHandout(ctx, handoutID); err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicChronicle)
	return api.DeleteHandout204Response{}, nil
}

// SetHandoutVisibility hands a prop over, or takes it back — party-wide or one
// hero at a time.
func (s *Server) SetHandoutVisibility(ctx context.Context, request api.SetHandoutVisibilityRequestObject) (api.SetHandoutVisibilityResponseObject, error) {
	handoutID := uuid.UUID(request.HandoutId)
	meta, err := s.handoutMeta(ctx, handoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetHandoutVisibility404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	member, err := s.requireDM(ctx, meta.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetHandoutVisibility401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetHandoutVisibility403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	grain, badReq, err := s.visibilityTarget(ctx, meta.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SetHandoutVisibility400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}

	switch {
	case grain.table:
		if _, err := s.queries.SetHandoutPartyVisibility(ctx, db.SetHandoutPartyVisibilityParams{
			ID: handoutID, VisibleToParty: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
		// Choosing the whole table is choosing everyone: exceptions go.
		if err := s.queries.ClearHandoutOverrides(ctx, handoutID); err != nil {
			return nil, err
		}
	case grain.party != uuid.Nil:
		if err := s.queries.SetHandoutOverridesForParty(ctx, db.SetHandoutOverridesForPartyParams{
			HandoutID: handoutID, PartyID: pgUUID(grain.party), Visible: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
	default:
		if err := s.queries.SetHandoutOverride(ctx, db.SetHandoutOverrideParams{
			HandoutID: handoutID, CharacterID: grain.hero, Visible: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
	}

	// Any reveal — to the party or to one hero — is the prop reaching someone
	// for the first time, and earns the line. Taking it back does not.
	if request.Body.Visible {
		s.handOver(ctx, meta.CampaignID, member.UserID, handoutID, meta.Title, meta.Caption)
	}
	out, err := s.buildOneHandout(ctx, handoutID)
	if err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicChronicle)
	return api.SetHandoutVisibility200JSONResponse(out), nil
}

// ClearHandoutVisibilityOverride drops one hero's exception so they follow the
// party again.
func (s *Server) ClearHandoutVisibilityOverride(ctx context.Context, request api.ClearHandoutVisibilityOverrideRequestObject) (api.ClearHandoutVisibilityOverrideResponseObject, error) {
	handoutID := uuid.UUID(request.HandoutId)
	meta, err := s.handoutMeta(ctx, handoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClearHandoutVisibilityOverride404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClearHandoutVisibilityOverride401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClearHandoutVisibilityOverride403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteHandoutOverride(ctx, db.DeleteHandoutOverrideParams{
		HandoutID:   handoutID,
		CharacterID: uuid.UUID(request.CharacterId),
	}); err != nil {
		return nil, err
	}
	out, err := s.buildOneHandout(ctx, handoutID)
	if err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicChronicle)
	return api.ClearHandoutVisibilityOverride200JSONResponse(out), nil
}

// canSeeHandout answers the image route and the chronicle filter: may this
// member look at this prop? The DM always may; everyone else is judged on the
// heroes they have seated.
func (s *Server) canSeeHandout(ctx context.Context, m db.Membership, handoutID uuid.UUID, partyFlag bool) (bool, error) {
	if m.Role == db.MembershipRoleDm {
		return true, nil
	}
	veil, err := s.loadHandoutVeil(ctx, m.CampaignID)
	if err != nil {
		return false, err
	}
	charIDs, err := s.seatedCharacterIDs(ctx, m.CampaignID, m.UserID)
	if err != nil {
		return false, err
	}
	return veil.visibleToAny(handoutID, partyFlag, charIDs), nil
}

// ServeHandoutImage streams a prop's bytes. Hand-rolled beside ServeMapImage
// and for the same reason — binary, cacheable, outside the JSON contract —
// with the veil re-checked here rather than trusted from the listing: the
// listing is what the client was told, this is what the server will hand over.
func (s *Server) ServeHandoutImage(w http.ResponseWriter, r *http.Request) {
	handoutID, err := uuid.Parse(chi.URLParam(r, "handoutID"))
	if err != nil {
		http.Error(w, "bad handout id", http.StatusBadRequest)
		return
	}
	if _, ok := auth.UserID(r.Context()); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	meta, err := s.handoutMeta(r.Context(), handoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	m, err := s.requireMember(r.Context(), meta.CampaignID)
	if err != nil {
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	allowed, err := s.canSeeHandout(r.Context(), m, handoutID, meta.VisibleToParty)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if !allowed {
		// 404, not 403: a veiled prop should not confirm it exists.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// The bytes never change once uploaded — swapping the picture means a new
	// handout — so the id and its creation stamp are a complete fingerprint.
	etag := fmt.Sprintf(`"handout-%s-%d"`, meta.ID, meta.CreatedAt.Time.Unix())
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	img, err := s.queries.GetHandoutImage(r.Context(), handoutID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", img.ContentType)
	w.Header().Set("ETag", etag)
	// no-cache, not no-store: revalidate every load so a prop taken back stops
	// being served from a browser cache the moment the DM lowers the veil.
	w.Header().Set("Cache-Control", "private, no-cache")
	_, _ = w.Write(img.Image)
}

// filterHandoutEvents drops chronicle lines whose prop this member may not
// look at, so a veiled handout is not announced by the feed that carries it.
//
// Resolved here rather than in the ListEvents query: the two-layer rule over
// "any of my heroes" is three joins and an aggregate in SQL, and one map
// lookup here. The cost is that a page of 50 can come back short when many
// veiled props sit inside it — a campaign has a handful of handouts against a
// feed of hundreds of lines, so the trade is worth the readable rule.
func (s *Server) filterHandoutEvents(ctx context.Context, m db.Membership, rows []db.ListEventsRow) ([]db.ListEventsRow, error) {
	if m.Role == db.MembershipRoleDm {
		return rows, nil
	}
	any := false
	for _, r := range rows {
		if r.HandoutID.Valid {
			any = true
			break
		}
	}
	if !any {
		return rows, nil
	}

	veil, err := s.loadHandoutVeil(ctx, m.CampaignID)
	if err != nil {
		return nil, err
	}
	charIDs, err := s.seatedCharacterIDs(ctx, m.CampaignID, m.UserID)
	if err != nil {
		return nil, err
	}
	handouts, err := s.queries.ListHandoutsByCampaign(ctx, m.CampaignID)
	if err != nil {
		return nil, err
	}
	partyFlag := make(map[uuid.UUID]bool, len(handouts))
	for _, h := range handouts {
		partyFlag[h.ID] = h.VisibleToParty
	}

	out := make([]db.ListEventsRow, 0, len(rows))
	for _, r := range rows {
		if r.HandoutID.Valid {
			id := uuid.UUID(r.HandoutID.Bytes)
			flag, known := partyFlag[id]
			if !known || !veil.visibleToAny(id, flag, charIDs) {
				continue
			}
		}
		out = append(out, r)
	}
	return out, nil
}
