package http

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Map layers (#355): named groups of the pins and shapes on one map.

The server owns two things about a layer and nothing else. Its **DM-only flag**
is a second veil on everything filed in it — absent from a player's payload,
exactly as a DM-only pin is — and the **layer list** rides the map so the
client can draw its Legend. Which layers a viewer has switched on is theirs
alone and kept in their browser; `shown_by_default` is only how a layer first
appears, a suggestion a player may overrule.

A layer is ground like the map it hangs on (#234): the same at every table on
the realm, read through a campaign's lens, and a change to one nudges the
realm. Striking one drops what was filed in it to the base map (SET NULL) —
nothing drawn is lost, which is why it is `campaigns:run` and not one of the
cascading strikes.
*/

const maxLayerName = 60

func toAPILayer(l db.MapLayer) api.MapLayer {
	return api.MapLayer{
		Id:             l.ID,
		MapId:          l.MapID,
		Name:           l.Name,
		Position:       int(l.Position),
		ShownByDefault: l.ShownByDefault,
		DmOnly:         l.DmOnly,
	}
}

// layerOf files a pin or a shape: the layer must hang on the very map the
// thing is drawn on, or the thing would be switched by another map's Legend.
// Absent, null and the nil UUID all mean the base map.
func (s *Server) layerOf(ctx context.Context, mapID uuid.UUID, id *uuid.UUID) (pgtype.UUID, string, error) {
	if id == nil || *id == uuid.Nil {
		return pgtype.UUID{}, "", nil
	}
	l, err := s.queries.GetMapLayerOnMap(ctx, db.GetMapLayerOnMapParams{ID: *id, MapID: mapID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgtype.UUID{}, "that layer is not one of this map's", nil
		}
		return pgtype.UUID{}, "", err
	}
	return pgUUID(l.ID), "", nil
}

// hiddenLayers is the set of a map's layers a player may not know of: the
// DM-only ones. Everything filed in them goes with them.
func hiddenLayers(layers []db.MapLayer) map[uuid.UUID]bool {
	out := map[uuid.UUID]bool{}
	for _, l := range layers {
		if l.DmOnly {
			out[l.ID] = true
		}
	}
	return out
}

func inHiddenLayer(layer pgtype.UUID, hidden map[uuid.UUID]bool) bool {
	return layer.Valid && hidden[uuid.UUID(layer.Bytes)]
}

func layerFields(body *api.MapLayerInput) (name string, shown, dmOnly bool, msg string) {
	name = strings.TrimSpace(body.Name)
	if name == "" {
		return "", false, false, "a layer needs a name"
	}
	if len([]rune(name)) > maxLayerName {
		return "", false, false, "a layer's name may run to 60 characters"
	}
	shown = body.ShownByDefault == nil || *body.ShownByDefault
	dmOnly = body.DmOnly != nil && *body.DmOnly
	return name, shown, dmOnly, ""
}

// requireLayerDM enforces the DM role over the lens, then resolves the layer
// through it (#234): a layer on another realm is no row, and answers 404.
func (s *Server) requireLayerDM(ctx context.Context, layerID, campaignID uuid.UUID) (db.GetMapLayerRow, error) {
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		return db.GetMapLayerRow{}, err
	}
	return s.queries.GetMapLayer(ctx, db.GetMapLayerParams{LayerID: layerID, CampaignID: campaignID})
}

// CreateMapLayer adds a named layer on top of a map's others (DM only).
func (s *Server) CreateMapLayer(ctx context.Context, request api.CreateMapLayerRequestObject) (api.CreateMapLayerResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.CreateMapLayer404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateMapLayer401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateMapLayer403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	name, shown, dmOnly, msg := layerFields(request.Body)
	if msg != "" {
		return api.CreateMapLayer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	layer, err := s.queries.CreateMapLayer(ctx, db.CreateMapLayerParams{
		MapID: request.MapId, Name: name, ShownByDefault: shown, DmOnly: dmOnly,
	})
	if err != nil {
		return nil, err
	}
	s.publishRealm(ctx, meta.RealmID, live.TopicMap)
	return api.CreateMapLayer201JSONResponse(toAPILayer(layer)), nil
}

// ReorderMapLayers sets the drawing order: the whole list, bottom to top.
// Nothing short of every layer on the map, each once, is an order.
func (s *Server) ReorderMapLayers(ctx context.Context, request api.ReorderMapLayersRequestObject) (api.ReorderMapLayersResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ReorderMapLayers404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ReorderMapLayers401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ReorderMapLayers403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	current, err := s.queries.ListMapLayers(ctx, request.MapId)
	if err != nil {
		return nil, err
	}
	onMap := map[uuid.UUID]bool{}
	for _, l := range current {
		onMap[l.ID] = true
	}
	ids := request.Body.LayerIds
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if !onMap[id] || seen[id] {
			seen = nil
			break
		}
		seen[id] = true
	}
	if seen == nil || len(ids) != len(current) {
		return api.ReorderMapLayers400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "an order names every layer on this map, each once",
		}}, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	for i, id := range ids {
		if err := qtx.SetMapLayerPosition(ctx, db.SetMapLayerPositionParams{ID: id, Position: int32(i)}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	layers, err := s.queries.ListMapLayers(ctx, request.MapId)
	if err != nil {
		return nil, err
	}
	out := make([]api.MapLayer, 0, len(layers))
	for _, l := range layers {
		out = append(out, toAPILayer(l))
	}
	s.publishRealm(ctx, meta.RealmID, live.TopicMap)
	return api.ReorderMapLayers200JSONResponse(out), nil
}

// UpdateMapLayer renames a layer, or changes how it starts or who sees it.
func (s *Server) UpdateMapLayer(ctx context.Context, request api.UpdateMapLayerRequestObject) (api.UpdateMapLayerResponseObject, error) {
	row, err := s.requireLayerDM(ctx, request.LayerId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.UpdateMapLayer404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.UpdateMapLayer401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateMapLayer403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	name, shown, dmOnly, msg := layerFields(request.Body)
	if msg != "" {
		return api.UpdateMapLayer400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	layer, err := s.queries.UpdateMapLayer(ctx, db.UpdateMapLayerParams{
		ID: request.LayerId, Name: name, ShownByDefault: shown, DmOnly: dmOnly,
	})
	if err != nil {
		return nil, err
	}
	s.publishRealm(ctx, row.RealmID, live.TopicMap)
	return api.UpdateMapLayer200JSONResponse(toAPILayer(layer)), nil
}

// DeleteMapLayer strikes a layer; what was filed in it drops to the base map.
func (s *Server) DeleteMapLayer(ctx context.Context, request api.DeleteMapLayerRequestObject) (api.DeleteMapLayerResponseObject, error) {
	row, err := s.requireLayerDM(ctx, request.LayerId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.DeleteMapLayer404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.DeleteMapLayer401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteMapLayer403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteMapLayer(ctx, request.LayerId); err != nil {
		return nil, err
	}
	s.publishRealm(ctx, row.RealmID, live.TopicMap)
	return api.DeleteMapLayer204Response{}, nil
}
