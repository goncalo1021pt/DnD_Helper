package http

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

func sortOverrides(o []api.VisibilityOverride) {
	sort.Slice(o, func(i, j int) bool { return o[i].CharacterName < o[j].CharacterName })
}

// optUUID turns an optional request id into the nullable column type; a nil
// pointer clears the reference (a place with no parent is a root).
func optUUID(p *uuid.UUID) pgtype.UUID {
	if p == nil {
		return pgtype.UUID{}
	}
	return pgUUID(*p)
}

// --- assembly ---

// buildLocations assembles the place tree for a campaign. The DM gets every
// place plus the veil state; a player gets only what their heroes can see.
func (s *Server) buildLocations(ctx context.Context, campaignID uuid.UUID, isDM bool, charIDs []uuid.UUID) ([]api.Location, error) {
	v, err := s.loadVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	quests, err := s.queries.ListQuestsByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}

	// Notices the caller can actually see, counted per place.
	questCount := map[uuid.UUID]int{}
	for _, q := range quests {
		if !q.LocationID.Valid {
			continue
		}
		if isDM || v.questVisibleToAny(q, charIDs) {
			questCount[q.LocationID.Bytes]++
		}
	}

	out := make([]api.Location, 0, len(v.locations))
	for id, l := range v.locations {
		if !isDM && !v.locationVisibleToAny(id, charIDs) {
			continue
		}
		depth, ok := v.depthOf(id)
		if !ok {
			// A broken chain would otherwise render as a phantom root.
			continue
		}
		loc := api.Location{
			Id:          l.ID,
			CampaignId:  l.CampaignID,
			Name:        l.Name,
			Description: l.Description,
			Depth:       depth,
			QuestCount:  questCount[id],
		}
		if l.ParentID.Valid {
			pid := uuid.UUID(l.ParentID.Bytes)
			loc.ParentId = &pid
		}
		if isDM {
			visible := l.VisibleToParty
			loc.VisibleToParty = &visible
			overrides := v.overridesFor(v.locOverrides[id])
			loc.Visibility = &overrides
			// Flag places the DM has revealed that stay dark anyway because
			// something above them is still veiled.
			hidden := l.ParentID.Valid && !v.locationVisibleTo(l.ParentID.Bytes, uuid.Nil)
			loc.HiddenByAncestor = &hidden
		}
		out = append(out, loc)
	}

	return treeOrder(out), nil
}

/*
treeOrder walks the places depth-first — each one immediately followed by
what is inside it, siblings alphabetical (#196).

The old order sorted by depth and then by name, which banded the list: every
continent together, then every kingdom in the world together, alphabetically
across unrelated parents. The page indents by depth, so two kingdoms with
different parents rendered as adjacent, equally indented rows under whichever
continent happened to sort last — and nothing on screen said which was whose.

A place whose parent is missing from this slice is a root here. That is the
normal case for a player, who is shown a revealed place while an ancestor
above it stays veiled; dropping it would hide a place the server just decided
they may see.
*/
func treeOrder(places []api.Location) []api.Location {
	children := make(map[uuid.UUID][]api.Location, len(places))
	present := make(map[uuid.UUID]bool, len(places))
	for _, l := range places {
		present[l.Id] = true
	}
	var roots []api.Location
	for _, l := range places {
		if l.ParentId != nil && present[*l.ParentId] {
			children[*l.ParentId] = append(children[*l.ParentId], l)
			continue
		}
		roots = append(roots, l)
	}
	byName := func(s []api.Location) {
		sort.Slice(s, func(i, j int) bool { return s[i].Name < s[j].Name })
	}
	byName(roots)
	for _, kids := range children {
		byName(kids)
	}

	out := make([]api.Location, 0, len(places))
	// `seen` is a cycle guard, not bookkeeping: the depth cap is enforced on
	// write, but this walks a slice the caller assembled, and a loop that ever
	// slipped through would otherwise recurse until the request died.
	seen := make(map[uuid.UUID]bool, len(places))
	var walk func(l api.Location)
	walk = func(l api.Location) {
		if seen[l.Id] {
			return
		}
		seen[l.Id] = true
		out = append(out, l)
		for _, kid := range children[l.Id] {
			walk(kid)
		}
	}
	for _, r := range roots {
		walk(r)
	}
	// Anything a cycle kept out of the walk still belongs in the answer.
	for _, l := range places {
		if !seen[l.Id] {
			out = append(out, l)
		}
	}
	return out
}

// buildOneLocation returns a single assembled place, from the DM's view.
func (s *Server) buildOneLocation(ctx context.Context, campaignID, locationID uuid.UUID) (api.Location, error) {
	all, err := s.buildLocations(ctx, campaignID, true, nil)
	if err != nil {
		return api.Location{}, err
	}
	for _, l := range all {
		if l.Id == locationID {
			return l, nil
		}
	}
	return api.Location{}, errors.New("location disappeared during assembly")
}

// --- handlers ---

func (s *Server) ListLocations(ctx context.Context, request api.ListLocationsRequestObject) (api.ListLocationsResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	m, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListLocations401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListLocations403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	isDM := m.Role == db.MembershipRoleDm
	var charIDs []uuid.UUID
	if !isDM {
		charIDs, err = s.seatedCharacterIDs(ctx, campaignID, m.UserID)
		if err != nil {
			return nil, err
		}
	}
	locs, err := s.buildLocations(ctx, campaignID, isDM, charIDs)
	if err != nil {
		return nil, err
	}
	return api.ListLocations200JSONResponse(locs), nil
}

func (s *Server) CreateLocation(ctx context.Context, request api.CreateLocationRequestObject) (api.CreateLocationResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateLocation401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateLocation403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	body := request.Body
	name := ""
	if body != nil {
		name = strings.TrimSpace(body.Name)
	}
	if name == "" || len([]rune(name)) > 200 {
		return api.CreateLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "name must be between 1 and 200 characters",
		}}, nil
	}

	v, err := s.loadVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if body.ParentId != nil {
		parentID := uuid.UUID(*body.ParentId)
		parent, ok := v.locations[parentID]
		if !ok || parent.CampaignID != campaignID {
			return api.CreateLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "parent location not found on this campaign",
			}}, nil
		}
		depth, ok := v.depthOf(parentID)
		if !ok || depth+1 >= maxLocationDepth {
			return api.CreateLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "places may nest at most 10 deep",
			}}, nil
		}
	}

	visible := false
	if body.VisibleToParty != nil {
		visible = *body.VisibleToParty
	}
	loc, err := s.queries.CreateLocation(ctx, db.CreateLocationParams{
		CampaignID:     campaignID,
		ParentID:       optUUID(body.ParentId),
		Name:           name,
		Description:    optStr(body.Description),
		VisibleToParty: visible,
	})
	if err != nil {
		return nil, err
	}
	out, err := s.buildOneLocation(ctx, campaignID, loc.ID)
	if err != nil {
		return nil, err
	}
	return api.CreateLocation201JSONResponse(out), nil
}

func (s *Server) UpdateLocation(ctx context.Context, request api.UpdateLocationRequestObject) (api.UpdateLocationResponseObject, error) {
	locationID := uuid.UUID(request.LocationId)
	loc, err := s.queries.GetLocation(ctx, locationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateLocation404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, loc.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateLocation401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateLocation403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	body := request.Body
	name := ""
	if body != nil {
		name = strings.TrimSpace(body.Name)
	}
	if name == "" || len([]rune(name)) > 200 {
		return api.UpdateLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "name must be between 1 and 200 characters",
		}}, nil
	}

	if _, err := s.queries.UpdateLocation(ctx, db.UpdateLocationParams{
		ID:          locationID,
		Name:        name,
		Description: body.Description,
	}); err != nil {
		return nil, err
	}
	out, err := s.buildOneLocation(ctx, loc.CampaignID, locationID)
	if err != nil {
		return nil, err
	}
	return api.UpdateLocation200JSONResponse(out), nil
}

// MoveLocation re-hangs a place — the "chart the city before the country and
// file it properly later" case. Its own endpoint rather than a field on the
// update, because a `parent_id` that is merely absent from a body is
// indistinguishable from one explicitly set to null, and guessing wrong
// detaches a subtree and lifts the veil on everything under it.
func (s *Server) MoveLocation(ctx context.Context, request api.MoveLocationRequestObject) (api.MoveLocationResponseObject, error) {
	locationID := uuid.UUID(request.LocationId)
	loc, err := s.queries.GetLocation(ctx, locationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.MoveLocation404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, loc.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.MoveLocation401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.MoveLocation403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.MoveLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "a parent is required — send null to make this place a root",
		}}, nil
	}

	v, err := s.loadVeil(ctx, loc.CampaignID)
	if err != nil {
		return nil, err
	}
	if request.Body.ParentId != nil {
		parentID := uuid.UUID(*request.Body.ParentId)
		parent, ok := v.locations[parentID]
		if !ok || parent.CampaignID != loc.CampaignID {
			return api.MoveLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "parent location not found on this campaign",
			}}, nil
		}
		// Moving a place inside itself (or inside its own child) would orphan
		// the whole subtree into a cycle.
		if parentID == locationID || v.isDescendant(parentID, locationID) {
			return api.MoveLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "a place cannot be moved inside itself",
			}}, nil
		}
		// The cap applies to the tree the move would create, so a deep subtree
		// cannot be smuggled under a parent that is itself near the limit.
		parentDepth, ok := v.depthOf(parentID)
		if !ok || parentDepth+1+v.heightBelow(locationID) >= maxLocationDepth {
			return api.MoveLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "places may nest at most 10 deep",
			}}, nil
		}
	}

	if _, err := s.queries.MoveLocation(ctx, db.MoveLocationParams{
		ID:       locationID,
		ParentID: optUUID(request.Body.ParentId),
	}); err != nil {
		return nil, err
	}
	out, err := s.buildOneLocation(ctx, loc.CampaignID, locationID)
	if err != nil {
		return nil, err
	}
	return api.MoveLocation200JSONResponse(out), nil
}

func (s *Server) DeleteLocation(ctx context.Context, request api.DeleteLocationRequestObject) (api.DeleteLocationResponseObject, error) {
	locationID := uuid.UUID(request.LocationId)
	loc, err := s.queries.GetLocation(ctx, locationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteLocation404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, loc.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteLocation401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteLocation403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	// Nested places cascade; quests hanging in any of them are unpinned by ON
	// DELETE SET NULL, so the notices survive losing their place. Stamp the
	// names down first so each notice still says where it used to hang.
	if err := s.queries.RememberLocationNamesBeforeDelete(ctx, locationID); err != nil {
		return nil, err
	}
	if err := s.queries.DeleteLocation(ctx, locationID); err != nil {
		return nil, err
	}
	return api.DeleteLocation204Response{}, nil
}

func (s *Server) SetLocationVisibility(ctx context.Context, request api.SetLocationVisibilityRequestObject) (api.SetLocationVisibilityResponseObject, error) {
	locationID := uuid.UUID(request.LocationId)
	loc, err := s.queries.GetLocation(ctx, locationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetLocationVisibility404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, loc.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetLocationVisibility401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetLocationVisibility403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	charID, badReq, err := s.visibilityTarget(ctx, loc.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SetLocationVisibility400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}

	if charID == uuid.Nil {
		if _, err := s.queries.SetLocationPartyVisibility(ctx, db.SetLocationPartyVisibilityParams{
			ID: locationID, VisibleToParty: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
		// Choosing the party is choosing everyone: per-hero exceptions go.
		if err := s.queries.ClearLocationOverrides(ctx, locationID); err != nil {
			return nil, err
		}
	} else if err := s.queries.SetLocationOverride(ctx, db.SetLocationOverrideParams{
		LocationID: locationID, CharacterID: charID, Visible: request.Body.Visible,
	}); err != nil {
		return nil, err
	}

	out, err := s.buildOneLocation(ctx, loc.CampaignID, locationID)
	if err != nil {
		return nil, err
	}
	return api.SetLocationVisibility200JSONResponse(out), nil
}

func (s *Server) SetQuestVisibility(ctx context.Context, request api.SetQuestVisibilityRequestObject) (api.SetQuestVisibilityResponseObject, error) {
	questID := uuid.UUID(request.QuestId)
	quest, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetQuestVisibility404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, quest.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetQuestVisibility401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetQuestVisibility403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	charID, badReq, err := s.visibilityTarget(ctx, quest.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SetQuestVisibility400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}

	if charID == uuid.Nil {
		if _, err := s.queries.SetQuestPartyVisibility(ctx, db.SetQuestPartyVisibilityParams{
			ID: questID, VisibleToParty: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
		if err := s.queries.ClearQuestOverrides(ctx, questID); err != nil {
			return nil, err
		}
	} else if err := s.queries.SetQuestOverride(ctx, db.SetQuestOverrideParams{
		QuestID: questID, CharacterID: charID, Visible: request.Body.Visible,
	}); err != nil {
		return nil, err
	}

	out, err := s.buildOneQuest(ctx, questID)
	if err != nil {
		return nil, err
	}
	return api.SetQuestVisibility200JSONResponse(out), nil
}

func (s *Server) ClearLocationVisibilityOverride(ctx context.Context, request api.ClearLocationVisibilityOverrideRequestObject) (api.ClearLocationVisibilityOverrideResponseObject, error) {
	locationID := uuid.UUID(request.LocationId)
	loc, err := s.queries.GetLocation(ctx, locationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClearLocationVisibilityOverride404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, loc.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClearLocationVisibilityOverride401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClearLocationVisibilityOverride403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteLocationOverride(ctx, db.DeleteLocationOverrideParams{
		LocationID: locationID, CharacterID: uuid.UUID(request.CharacterId),
	}); err != nil {
		return nil, err
	}
	out, err := s.buildOneLocation(ctx, loc.CampaignID, locationID)
	if err != nil {
		return nil, err
	}
	return api.ClearLocationVisibilityOverride200JSONResponse(out), nil
}

func (s *Server) ClearQuestVisibilityOverride(ctx context.Context, request api.ClearQuestVisibilityOverrideRequestObject) (api.ClearQuestVisibilityOverrideResponseObject, error) {
	questID := uuid.UUID(request.QuestId)
	quest, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClearQuestVisibilityOverride404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, quest.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClearQuestVisibilityOverride401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClearQuestVisibilityOverride403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteQuestOverride(ctx, db.DeleteQuestOverrideParams{
		QuestID: questID, CharacterID: uuid.UUID(request.CharacterId),
	}); err != nil {
		return nil, err
	}
	out, err := s.buildOneQuest(ctx, questID)
	if err != nil {
		return nil, err
	}
	return api.ClearQuestVisibilityOverride200JSONResponse(out), nil
}

// visibilityTarget validates a reveal/hide request and resolves who it applies
// to: uuid.Nil for the whole party, or a hero seated at this campaign. The
// middle return is a client-facing rejection reason, empty when the request is
// good.
func (s *Server) visibilityTarget(ctx context.Context, campaignID uuid.UUID, body *api.SetVisibilityRequest) (uuid.UUID, string, error) {
	if body == nil {
		return uuid.Nil, "a visibility scope is required", nil
	}
	switch body.Scope {
	case api.VisibilityScopeParty:
		return uuid.Nil, "", nil
	case api.VisibilityScopeCharacter:
		if body.CharacterId == nil {
			return uuid.Nil, "characterId is required when scope is character", nil
		}
		charID := uuid.UUID(*body.CharacterId)
		chars, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
		if err != nil {
			return uuid.Nil, "", err
		}
		for _, c := range chars {
			if c.ID == charID {
				return charID, "", nil
			}
		}
		return uuid.Nil, "that hero is not seated at this campaign", nil
	default:
		return uuid.Nil, "scope must be party or character", nil
	}
}
