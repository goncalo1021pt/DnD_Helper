package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
The veil over a map's existence (#276).

Fog covered the ground and left the map itself shouting that there was ground
to cover: every member received every map in the campaign, so the atlas listed
the name of the dungeon the party had not found and the picture opened for
anyone holding the id. A map is a piece of knowledge like a village or a
person, and it carries the same veil they do — one party-wide flag with
per-hero exceptions over it, resolved through the viewer's own heroes, so the
DM's control is the very same three-grain one.

Two gates, no more:

  1. The map's own two layers.
  2. The PLACE it depicts, when it depicts one (#229), walked to the root — so
     veiling Barovia veils the city map of Barovia without a second thought.

The map TREE is deliberately not a third. `parent_map_id` says where a picture
hangs, not what is known: a sub-map's parent is a filing decision, and a DM who
veils an overworld and forgets its dungeons should be told so by an atlas that
still lists them rather than have them vanish by a rule nobody typed. The atlas
already re-roots a map whose parent it cannot see, so one revealed under a
veiled overworld lists cleanly on its own.

Redaction is absence, as everywhere: a veiled map is missing from the list, and
GET /maps/{id} and its image both answer 404. A 403 would confirm the dungeon
exists, which is the one thing the veil is for.
*/

// mapVeil answers "may this hero know that map exists?". Its own loader rather
// than another map on veil, for the same reason handouts and the Folk have
// theirs: the quest board should not pay for a table it never reads. What is
// shared is the rule — resolve() — plus the place walk, borrowed from the
// campaign veil at the call site.
type mapVeil struct {
	// map id -> character id -> visible
	overrides map[uuid.UUID]map[uuid.UUID]bool
	charNames map[uuid.UUID]string
}

func (s *Server) loadMapVeil(ctx context.Context, campaignID uuid.UUID) (*mapVeil, error) {
	rows, err := s.queries.ListMapVisibilityByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	v := &mapVeil{
		overrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames: map[uuid.UUID]string{},
	}
	for _, r := range rows {
		if v.overrides[r.MapID] == nil {
			v.overrides[r.MapID] = map[uuid.UUID]bool{}
		}
		v.overrides[r.MapID][r.CharacterID] = r.Visible
		v.charNames[r.CharacterID] = r.CharacterName
	}
	return v, nil
}

// visibleTo resolves one map for one hero: the map's own two layers, then the
// place it depicts, all the way up. A map filed nowhere is judged on its own
// veil alone.
func (v *mapVeil) visibleTo(m mapRow, places *veil, charID uuid.UUID) bool {
	if !resolve(m.VisibleToParty, v.overrides[m.ID], charID) {
		return false
	}
	if !m.LocationID.Valid {
		return true
	}
	return places.locationVisibleTo(uuid.UUID(m.LocationID.Bytes), charID)
}

// visibleToAny reports whether any of a member's heroes may know of it. A
// member with no seated hero is judged by the party-wide veil alone.
func (v *mapVeil) visibleToAny(m mapRow, places *veil, charIDs []uuid.UUID) bool {
	if len(charIDs) == 0 {
		return v.visibleTo(m, places, uuid.Nil)
	}
	for _, id := range charIDs {
		if v.visibleTo(m, places, id) {
			return true
		}
	}
	return false
}

// overridesFor renders the DM-facing list of heroes singled out on a map.
func (v *mapVeil) overridesFor(mapID uuid.UUID) []api.VisibilityOverride {
	out := make([]api.VisibilityOverride, 0, len(v.overrides[mapID]))
	for charID, visible := range v.overrides[mapID] {
		out = append(out, api.VisibilityOverride{
			CharacterId:   charID,
			CharacterName: v.charNames[charID],
			Visible:       visible,
		})
	}
	sortOverrides(out)
	return out
}

// mapViewer is everything needed to answer "may this member know that map
// exists?", loaded once per request. The DM's costs nothing; a player's is
// three reads — the place tree, the exceptions, and which heroes are theirs.
//
// Loaded once and not per map, deliberately. GetMap asks it about the map on
// the table AND about every marker leading into another one, and resolving each
// of those by re-reading the campaign's veils is how a page turns into fifty
// queries — the lesson #181 learned the hard way.
//
// The same struct serves the JSON map and the image route, so the two can never
// disagree about whether a map exists — what filterRevealCircles does for fog.
type mapViewer struct {
	isDM    bool
	places  *veil
	veil    *mapVeil
	charIDs []uuid.UUID
}

func (s *Server) mapViewerFor(ctx context.Context, campaignID, userID uuid.UUID, isDM bool) (*mapViewer, error) {
	v := &mapViewer{isDM: isDM}
	mv, err := s.loadMapVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	v.veil = mv
	if isDM {
		return v, nil
	}
	if v.places, err = s.loadVeil(ctx, campaignID); err != nil {
		return nil, err
	}
	if v.charIDs, err = s.seatedCharacterIDs(ctx, campaignID, userID); err != nil {
		return nil, err
	}
	return v, nil
}

// mayRead answers for one map. The DM reads everything, always.
func (v *mapViewer) mayRead(m mapRow) bool {
	if v.isDM {
		return true
	}
	return v.veil.visibleToAny(m, v.places, v.charIDs)
}

// SetMapVisibility reveals or hides a map at one of three grains (DM only).
func (s *Server) SetMapVisibility(ctx context.Context, request api.SetMapVisibilityRequestObject) (api.SetMapVisibilityResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetMapVisibility404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetMapVisibility401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetMapVisibility403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	grain, badReq, err := s.visibilityTarget(ctx, meta.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SetMapVisibility400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}
	switch {
	case grain.table:
		if _, err := s.queries.SetMapPartyVisibility(ctx, db.SetMapPartyVisibilityParams{
			ID: meta.ID, VisibleToParty: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
		// Choosing the whole table is choosing everyone: exceptions go.
		if err := s.queries.ClearMapOverrides(ctx, meta.ID); err != nil {
			return nil, err
		}
	case grain.party != uuid.Nil:
		if err := s.queries.SetMapOverridesForParty(ctx, db.SetMapOverridesForPartyParams{
			MapID: meta.ID, PartyID: pgUUID(grain.party), Visible: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
	default:
		if err := s.queries.SetMapOverride(ctx, db.SetMapOverrideParams{
			MapID: meta.ID, CharacterID: grain.hero, Visible: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
	}
	out, err := s.oneMapForDM(ctx, meta.CampaignID, meta.ID)
	if err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicMap)
	return api.SetMapVisibility200JSONResponse(out), nil
}

// ClearMapVisibilityOverride drops one hero's exception (DM only).
func (s *Server) ClearMapVisibilityOverride(ctx context.Context, request api.ClearMapVisibilityOverrideRequestObject) (api.ClearMapVisibilityOverrideResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClearMapVisibilityOverride404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClearMapVisibilityOverride401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClearMapVisibilityOverride403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if err := s.queries.DeleteMapOverride(ctx, db.DeleteMapOverrideParams{
		MapID: meta.ID, CharacterID: request.CharacterId,
	}); err != nil {
		return nil, err
	}
	out, err := s.oneMapForDM(ctx, meta.CampaignID, meta.ID)
	if err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicMap)
	return api.ClearMapVisibilityOverride200JSONResponse(out), nil
}

// oneMapForDM re-reads a map with its veil, for the response to a veil change.
// It goes through the campaign list so the place name rides along, exactly as
// the atlas gets it.
func (s *Server) oneMapForDM(ctx context.Context, campaignID, mapID uuid.UUID) (api.CampaignMap, error) {
	mv, err := s.loadMapVeil(ctx, campaignID)
	if err != nil {
		return api.CampaignMap{}, err
	}
	rows, err := s.queries.ListMapsByCampaign(ctx, campaignID)
	if err != nil {
		return api.CampaignMap{}, err
	}
	for _, r := range rows {
		if r.ID != mapID {
			continue
		}
		m := toAPIMap(listedMapRow(r), true, mv.overridesFor(mapID))
		m.LocationName = r.LocationName
		return m, nil
	}
	return api.CampaignMap{}, pgx.ErrNoRows
}
