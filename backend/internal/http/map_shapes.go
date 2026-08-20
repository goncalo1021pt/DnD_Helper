package http

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Roads and realms drawn on the map (#262).

Two asks that look like different features and are the same one: a brush that
draws a street, and an overlay that tints a kingdom. Both are an ordered run of
points; only whether the run is stroked along or filled in differs. So one
table, one endpoint and one drawing gesture serve both, and `kind` is the only
thing that separates them.

They are veiled exactly as pins are, because a road is as much a piece of
knowledge as a village: a DM-only shape is absent from a player's payload
rather than flagged, and under fog a line is CLIPPED to the stretches standing
on ground that player has uncovered — a highway does not announce where it goes
because the party found one mile of it.
*/

const (
	maxShapeLabel  = 80
	maxShapePoints = 400
	// A stroke thinner than this is invisible at any zoom; wider than this and
	// it is no longer a road but a wash of colour.
	minShapeWidth = 0.0005
	maxShapeWidth = 0.05
)

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

type shapePoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func decodePoints(raw []byte) []shapePoint {
	var pts []shapePoint
	_ = json.Unmarshal(raw, &pts)
	return pts
}

// toAPIShape renders a stored shape, optionally with a run of points other than
// its own — which is what fog clipping hands back.
func toAPIShape(s db.MapShape, locationName *string, points []shapePoint) api.MapShape {
	out := api.MapShape{
		Id:        s.ID,
		MapId:     s.MapID,
		Kind:      api.MapShapeKind(s.Kind),
		Label:     s.Label,
		Color:     s.Color,
		Dashed:    s.Dashed,
		Width:     float32(s.Width),
		Opacity:   float32(s.Opacity),
		DmOnly:    s.DmOnly,
		CreatedAt: s.CreatedAt.Time,
		Points:    make([]api.MapPoint, 0, len(points)),
	}
	for _, p := range points {
		out.Points = append(out.Points, api.MapPoint{X: float32(p.X), Y: float32(p.Y)})
	}
	if s.LocationID.Valid {
		id := uuid.UUID(s.LocationID.Bytes)
		out.LocationId = &id
		out.LocationName = locationName
	}
	return out
}

// validateShapeInput bounds everything a DM can hand over, and resolves the
// place a shape may stand for. The middle return is a client-facing reason.
func (s *Server) validateShapeInput(ctx context.Context, campaignID uuid.UUID, body *api.MapShapeInput) (db.CreateMapShapeParams, string, error) {
	var out db.CreateMapShapeParams
	if body == nil {
		return out, "a shape is required", nil
	}
	kind := db.MapShapeKind(body.Kind)
	if kind != db.MapShapeKindLine && kind != db.MapShapeKindArea {
		return out, "a shape is either a line or an area", nil
	}
	// A line needs two points to go anywhere; an area needs three to enclose
	// anything. Below that it is not a shape, it is a stray tap.
	least := 2
	if kind == db.MapShapeKindArea {
		least = 3
	}
	if len(body.Points) < least || len(body.Points) > maxShapePoints {
		return out, "a line needs at least two points and an area at least three, and no shape may pass 400", nil
	}
	pts := make([]shapePoint, 0, len(body.Points))
	for _, p := range body.Points {
		pts = append(pts, shapePoint{
			X: clampFloat(float64(p.X), 0, 1),
			Y: clampFloat(float64(p.Y), 0, 1),
		})
	}
	raw, err := json.Marshal(pts)
	if err != nil {
		return out, "", err
	}

	color := "#c96a5a"
	if body.Color != nil && hexColor.MatchString(*body.Color) {
		color = strings.ToLower(*body.Color)
	} else if body.Color != nil {
		return out, "a colour is six hex digits behind a hash, like #c96a5a", nil
	}
	label := ""
	if body.Label != nil {
		label = strings.TrimSpace(*body.Label)
		if len([]rune(label)) > maxShapeLabel {
			return out, "a label may run to 80 characters", nil
		}
	}
	width := 0.004
	if body.Width != nil {
		width = clampFloat(float64(*body.Width), minShapeWidth, maxShapeWidth)
	}
	opacity := 0.25
	if body.Opacity != nil {
		opacity = clampFloat(float64(*body.Opacity), 0.02, 1)
	}

	// The place a shape stands for, resolved through this campaign only — a
	// map must not be able to name somebody else's world.
	var location pgtype.UUID
	if body.LocationId != nil && uuid.UUID(*body.LocationId) != uuid.Nil {
		loc, err := s.queries.GetLocation(ctx, uuid.UUID(*body.LocationId))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return out, "that place is not one of this campaign's", nil
			}
			return out, "", err
		}
		if loc.CampaignID != campaignID {
			return out, "that place is not one of this campaign's", nil
		}
		location = pgUUID(loc.ID)
	}

	return db.CreateMapShapeParams{
		Kind: kind, Label: label, Points: raw, Color: color,
		Dashed: body.Dashed != nil && *body.Dashed,
		Width:  width, Opacity: opacity,
		DmOnly: body.DmOnly != nil && *body.DmOnly, LocationID: location,
	}, "", nil
}

// shapeName reads the place a shape stands for, for the payload's label.
func (s *Server) shapeName(ctx context.Context, id pgtype.UUID) *string {
	if !id.Valid {
		return nil
	}
	loc, err := s.queries.GetLocation(ctx, uuid.UUID(id.Bytes))
	if err != nil {
		return nil
	}
	return &loc.Name
}

/*
What a player is handed of a shape, under fog.

A pin is one point, so it is in or it is out. A shape runs across the map, and
the honest answer differs by kind:

  - a LINE is clipped to its revealed runs. The road appears as the party walks
    it, mile by mile, which is both the truthful answer and the nicer one.
    Each surviving run is its own shape on the wire, sharing the parent's id —
    the client draws them, it does not edit them.
  - an AREA is all or nothing on any point being revealed, because dropping
    points from a polygon does not clip it, it redraws it into a different
    country. A border does leak once any corner of it is seen, and that is what
    `dmOnly` is for: a region the party should not yet have the shape of is
    simply not sent.
*/
func clipShape(kind db.MapShapeKind, pts []shapePoint, seen func(shapePoint) bool) [][]shapePoint {
	if kind == db.MapShapeKindArea {
		for _, p := range pts {
			if seen(p) {
				return [][]shapePoint{pts}
			}
		}
		return nil
	}
	var runs [][]shapePoint
	var run []shapePoint
	for _, p := range pts {
		if seen(p) {
			run = append(run, p)
			continue
		}
		if len(run) >= 2 {
			runs = append(runs, run)
		}
		run = nil
	}
	if len(run) >= 2 {
		runs = append(runs, run)
	}
	return runs
}

// shapesFor assembles every shape on a map as this viewer may have it.
func (s *Server) shapesFor(ctx context.Context, mapID uuid.UUID, isDM bool, aspect float64, revealed []api.RevealCircle, fogged bool) ([]api.MapShape, error) {
	rows, err := s.queries.ListMapShapes(ctx, mapID)
	if err != nil {
		return nil, err
	}
	seen := func(p shapePoint) bool {
		for _, c := range revealed {
			dx := p.X - float64(c.X)
			dy := (p.Y - float64(c.Y)) * aspect
			r := float64(c.R)
			if dx*dx+dy*dy <= r*r {
				return true
			}
		}
		return false
	}
	out := make([]api.MapShape, 0, len(rows))
	for _, row := range rows {
		pts := decodePoints(row.Points)
		if isDM {
			out = append(out, toAPIShape(row, s.shapeName(ctx, row.LocationID), pts))
			continue
		}
		if row.DmOnly {
			continue
		}
		if !fogged {
			out = append(out, toAPIShape(row, s.shapeName(ctx, row.LocationID), pts))
			continue
		}
		for _, run := range clipShape(row.Kind, pts, seen) {
			out = append(out, toAPIShape(row, s.shapeName(ctx, row.LocationID), run))
		}
	}
	return out, nil
}

// requireShapeDM resolves a shape and enforces the DM role over its campaign.
func (s *Server) requireShapeDM(ctx context.Context, shapeID uuid.UUID) (db.GetMapShapeRow, error) {
	row, err := s.queries.GetMapShape(ctx, shapeID)
	if err != nil {
		return db.GetMapShapeRow{}, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		return db.GetMapShapeRow{}, err
	}
	return row, nil
}

func (s *Server) CreateMapShape(ctx context.Context, request api.CreateMapShapeRequestObject) (api.CreateMapShapeResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.CreateMapShape404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateMapShape401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateMapShape403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	params, msg, err := s.validateShapeInput(ctx, meta.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return api.CreateMapShape400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	params.MapID = request.MapId
	row, err := s.queries.CreateMapShape(ctx, params)
	if err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicMap)
	return api.CreateMapShape201JSONResponse(
		toAPIShape(row, s.shapeName(ctx, row.LocationID), decodePoints(row.Points))), nil
}

func (s *Server) UpdateMapShape(ctx context.Context, request api.UpdateMapShapeRequestObject) (api.UpdateMapShapeResponseObject, error) {
	current, err := s.requireShapeDM(ctx, request.ShapeId)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.UpdateMapShape404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.UpdateMapShape401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateMapShape403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	params, msg, err := s.validateShapeInput(ctx, current.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return api.UpdateMapShape400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	// A shape does not change what it IS — a road cannot become a kingdom by
	// being restyled. Rub it out and draw the other one.
	if params.Kind != current.Kind {
		return api.UpdateMapShape400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "a line cannot become an area — rub it out and draw the other",
		}}, nil
	}
	row, err := s.queries.UpdateMapShape(ctx, db.UpdateMapShapeParams{
		ID: request.ShapeId, Label: params.Label, Points: params.Points,
		Color: params.Color, Dashed: params.Dashed, Width: params.Width,
		Opacity: params.Opacity, DmOnly: params.DmOnly, LocationID: params.LocationID,
	})
	if err != nil {
		return nil, err
	}
	s.publish(current.CampaignID, live.TopicMap)
	return api.UpdateMapShape200JSONResponse(
		toAPIShape(row, s.shapeName(ctx, row.LocationID), decodePoints(row.Points))), nil
}

func (s *Server) DeleteMapShape(ctx context.Context, request api.DeleteMapShapeRequestObject) (api.DeleteMapShapeResponseObject, error) {
	current, err := s.requireShapeDM(ctx, request.ShapeId)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.DeleteMapShape404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.DeleteMapShape401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteMapShape403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteMapShape(ctx, request.ShapeId); err != nil {
		return nil, err
	}
	s.publish(current.CampaignID, live.TopicMap)
	return api.DeleteMapShape204Response{}, nil
}
