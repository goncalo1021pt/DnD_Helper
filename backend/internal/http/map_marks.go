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
A player's own marks on a map (#356).

A mark is a pin or a line with an author. It rides the same rows the DM's ink
does, and differs from it in the one way that matters: it is **knowledge, not
ground**. The DM's pin hangs on the realm and every table on it walks past it;
a mark was made at one table, carries that campaign, and no other campaign on
the realm ever receives it — not even through its DM.

Who reads a mark, at its own table:
  - its author, always, wherever it stands — it is their note;
  - the table's DMs, always — and a DM may pull one, never reword it;
  - everyone else only when the author has `shared` it, and then exactly as
    they would read the DM's ink: a pin standing in fog is not sent, a line is
    clipped to the ground they have uncovered.

A mark names no place, leads into no map, sits in no DM layer and is never
dm_only, so none of those veils has a case to answer. The schema holds the one
rule that would otherwise need remembering at every door that ends a seat: the
(author, campaign) pair references the membership, so leaving, being removed
or barred, and striking the campaign take the marks with the seat.
*/

// isMark says whether a row is a player's mark rather than the DM's ink.
func isMark(author pgtype.UUID) bool { return author.Valid }

// markAt reports whether a mark belongs to the table read through this lens.
func markAt(campaign pgtype.UUID, lens uuid.UUID) bool {
	return campaign.Valid && uuid.UUID(campaign.Bytes) == lens
}

// markVisible is the mark veil, bar the fog: the author and the DMs, and the
// rest of the table when it is shared. A mark from another table is nobody's.
func markVisible(author, campaign pgtype.UUID, shared bool, lens, viewer uuid.UUID, isDM bool) bool {
	if !markAt(campaign, lens) {
		return false
	}
	return isDM || uuid.UUID(author.Bytes) == viewer || shared
}

// markIsOthers is whether a visible mark reaches this viewer as someone else's
// shared ink — the case the fog applies to, as it does to the DM's.
func markIsOthers(author pgtype.UUID, viewer uuid.UUID, isDM bool) bool {
	return !isDM && uuid.UUID(author.Bytes) != viewer
}

// memberNames maps the people at a table to the names their marks go under.
func (s *Server) memberNames(ctx context.Context, campaignID uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := s.queries.ListMembers(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]string, len(rows))
	for _, r := range rows {
		out[r.UserID] = r.Name
	}
	return out, nil
}

func authorNameOf(author pgtype.UUID, names map[uuid.UUID]string) *string {
	if !author.Valid {
		return nil
	}
	if n, ok := names[uuid.UUID(author.Bytes)]; ok {
		return &n
	}
	return nil
}

// markTable is the membership, and the map read through the lens, that a
// player needs to put a mark on it: they must be at the table and may mark
// only a map they are allowed to know exists (#276).
func (s *Server) markTable(ctx context.Context, mapID, lens uuid.UUID) (db.GetMapMetaForCampaignRow, db.Membership, error) {
	meta, err := s.mapMeta(ctx, mapID, lens)
	if err != nil {
		return meta, db.Membership{}, err
	}
	m, err := s.requireMember(ctx, meta.CampaignID)
	if err != nil {
		return meta, m, err
	}
	viewer, err := s.mapViewerFor(ctx, meta.CampaignID, m.UserID, m.Role == db.MembershipRoleDm)
	if err != nil {
		return meta, m, err
	}
	if !viewer.mayRead(mapRow(meta)) {
		return meta, m, pgx.ErrNoRows
	}
	return meta, m, nil
}

// ownMark resolves a mark through the lens for its author alone. Anybody
// else's row — the DM's ink, another player's mark, another table's — is no
// row: a mark you cannot change is not one you are told about here.
func ownMark(author, campaign pgtype.UUID, lens, caller uuid.UUID) bool {
	return isMark(author) && markAt(campaign, lens) && uuid.UUID(author.Bytes) == caller
}

func markPinFields(body *api.MapMarkPinInput) (label, note, shape string, msg string) {
	label = strings.TrimSpace(body.Label)
	if label == "" {
		return "", "", "", "the mark needs a label"
	}
	if body.X < 0 || body.X > 1 || body.Y < 0 || body.Y > 1 {
		return "", "", "", "mark coordinates are fractions of the map, 0 to 1"
	}
	if body.Note != nil {
		note = strings.TrimSpace(*body.Note)
	}
	shape = "pin"
	if body.Shape != nil && *body.Shape != "" {
		shape = string(*body.Shape)
		if !pinShapes[shape] {
			return "", "", "", "that is not a marker this map knows"
		}
	}
	return label, note, shape, ""
}

// markLineParams bounds a line mark with the very rules the DM's roads obey,
// by handing it to the same validator as a line with nothing else on it.
func (s *Server) markLineParams(ctx context.Context, lens, mapID uuid.UUID, body *api.MapMarkLineInput) (db.CreateMapShapeParams, string, error) {
	return s.validateShapeInput(ctx, lens, mapID, &api.MapShapeInput{
		Kind:   api.MapShapeInputKindLine,
		Label:  body.Label,
		Points: body.Points,
		Color:  body.Color,
		Dashed: body.Dashed,
		Width:  body.Width,
	})
}

func (s *Server) CreateMarkPin(ctx context.Context, request api.CreateMarkPinRequestObject) (api.CreateMarkPinResponseObject, error) {
	lens := uuid.UUID(request.Params.CampaignId)
	meta, m, err := s.markTable(ctx, request.MapId, lens)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.CreateMarkPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.CreateMarkPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateMarkPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	label, note, shape, msg := markPinFields(request.Body)
	if msg != "" {
		return api.CreateMarkPin400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	pin, err := s.queries.CreateMarkPin(ctx, db.CreateMarkPinParams{
		MapID: request.MapId, Label: label, Note: note,
		X: float64(request.Body.X), Y: float64(request.Body.Y), Shape: shape,
		AuthorUserID: pgUUID(m.UserID), CampaignID: pgUUID(meta.CampaignID),
		Shared: request.Body.Shared != nil && *request.Body.Shared,
	})
	if err != nil {
		return nil, err
	}
	// Knowledge, not ground: only this table hears of it.
	s.publish(meta.CampaignID, live.TopicMap)
	out := toAPIPin(pin, nil)
	out.AuthorName = s.nameOf(ctx, meta.CampaignID, m.UserID)
	return api.CreateMarkPin201JSONResponse(out), nil
}

func (s *Server) UpdateMarkPin(ctx context.Context, request api.UpdateMarkPinRequestObject) (api.UpdateMarkPinResponseObject, error) {
	lens := uuid.UUID(request.Params.CampaignId)
	m, err := s.requireMember(ctx, lens)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateMarkPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateMarkPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	row, err := s.queries.GetMapPin(ctx, db.GetMapPinParams{PinID: request.PinId, CampaignID: lens})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !ownMark(row.AuthorUserID, row.CampaignID, lens, m.UserID)) {
		return api.UpdateMarkPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if err != nil {
		return nil, err
	}
	label, note, shape, msg := markPinFields(request.Body)
	if msg != "" {
		return api.UpdateMarkPin400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	pin, err := s.queries.UpdateMarkPin(ctx, db.UpdateMarkPinParams{
		ID: request.PinId, Label: label, Note: note,
		X: float64(request.Body.X), Y: float64(request.Body.Y), Shape: shape,
		Shared: request.Body.Shared != nil && *request.Body.Shared,
	})
	if err != nil {
		return nil, err
	}
	s.publish(lens, live.TopicMap)
	out := toAPIPin(pin, nil)
	out.AuthorName = s.nameOf(ctx, lens, m.UserID)
	return api.UpdateMarkPin200JSONResponse(out), nil
}

func (s *Server) DeleteMarkPin(ctx context.Context, request api.DeleteMarkPinRequestObject) (api.DeleteMarkPinResponseObject, error) {
	lens := uuid.UUID(request.Params.CampaignId)
	m, err := s.requireMember(ctx, lens)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteMarkPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteMarkPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	row, err := s.queries.GetMapPin(ctx, db.GetMapPinParams{PinID: request.PinId, CampaignID: lens})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !ownMark(row.AuthorUserID, row.CampaignID, lens, m.UserID)) {
		return api.DeleteMarkPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.queries.DeleteMapPin(ctx, request.PinId); err != nil {
		return nil, err
	}
	s.publish(lens, live.TopicMap)
	return api.DeleteMarkPin204Response{}, nil
}

func (s *Server) CreateMarkLine(ctx context.Context, request api.CreateMarkLineRequestObject) (api.CreateMarkLineResponseObject, error) {
	lens := uuid.UUID(request.Params.CampaignId)
	meta, m, err := s.markTable(ctx, request.MapId, lens)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.CreateMarkLine404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.CreateMarkLine401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateMarkLine403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	p, msg, err := s.markLineParams(ctx, meta.CampaignID, request.MapId, request.Body)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return api.CreateMarkLine400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	row, err := s.queries.CreateMarkLine(ctx, db.CreateMarkLineParams{
		MapID: request.MapId, Label: p.Label, Points: p.Points, Color: p.Color,
		Dashed: p.Dashed, Width: p.Width,
		AuthorUserID: pgUUID(m.UserID), CampaignID: pgUUID(meta.CampaignID),
		Shared: request.Body.Shared != nil && *request.Body.Shared,
	})
	if err != nil {
		return nil, err
	}
	s.publish(meta.CampaignID, live.TopicMap)
	out := toAPIShape(row, nil, decodePoints(row.Points))
	out.AuthorName = s.nameOf(ctx, meta.CampaignID, m.UserID)
	return api.CreateMarkLine201JSONResponse(out), nil
}

func (s *Server) UpdateMarkLine(ctx context.Context, request api.UpdateMarkLineRequestObject) (api.UpdateMarkLineResponseObject, error) {
	lens := uuid.UUID(request.Params.CampaignId)
	m, err := s.requireMember(ctx, lens)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateMarkLine401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateMarkLine403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	row, err := s.queries.GetMapShape(ctx, db.GetMapShapeParams{ShapeID: request.ShapeId, CampaignID: lens})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !ownMark(row.AuthorUserID, row.CampaignID, lens, m.UserID)) {
		return api.UpdateMarkLine404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if err != nil {
		return nil, err
	}
	p, msg, err := s.markLineParams(ctx, lens, row.MapID, request.Body)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return api.UpdateMarkLine400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	updated, err := s.queries.UpdateMarkLine(ctx, db.UpdateMarkLineParams{
		ID: request.ShapeId, Label: p.Label, Points: p.Points, Color: p.Color,
		Dashed: p.Dashed, Width: p.Width,
		Shared: request.Body.Shared != nil && *request.Body.Shared,
	})
	if err != nil {
		return nil, err
	}
	s.publish(lens, live.TopicMap)
	out := toAPIShape(updated, nil, decodePoints(updated.Points))
	out.AuthorName = s.nameOf(ctx, lens, m.UserID)
	return api.UpdateMarkLine200JSONResponse(out), nil
}

func (s *Server) DeleteMarkLine(ctx context.Context, request api.DeleteMarkLineRequestObject) (api.DeleteMarkLineResponseObject, error) {
	lens := uuid.UUID(request.Params.CampaignId)
	m, err := s.requireMember(ctx, lens)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteMarkLine401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteMarkLine403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	row, err := s.queries.GetMapShape(ctx, db.GetMapShapeParams{ShapeID: request.ShapeId, CampaignID: lens})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !ownMark(row.AuthorUserID, row.CampaignID, lens, m.UserID)) {
		return api.DeleteMarkLine404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.queries.DeleteMapShape(ctx, request.ShapeId); err != nil {
		return nil, err
	}
	s.publish(lens, live.TopicMap)
	return api.DeleteMarkLine204Response{}, nil
}

// nameOf is one member's name, for the mark a handler hands back.
func (s *Server) nameOf(ctx context.Context, campaignID, userID uuid.UUID) *string {
	names, err := s.memberNames(ctx, campaignID)
	if err != nil {
		return nil
	}
	return authorNameOf(pgUUID(userID), names)
}
