package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

// Fog of war, stage 1: the DM stamps reveal circles on a draft client-side
// and submits them here as batches. Every batch lands in the campaign's
// single implicit party pool; the schema already speaks pools, so split
// parties and merging are a later UI, not a rework.
//
// A batch may also name a place (#191). Two gates then stand in front of its
// ground, and a player needs both: the pool, which says whose map this is,
// and the place's veil, which says who has been told about it. That second
// gate is the whole feature — the DM stamps a city once and hands it to the
// hero who grew up there, and the same stamps serve the party later without
// being drawn again.

// partyPool fetches the campaign's party pool, creating it on first use.
func (s *Server) partyPool(ctx context.Context, campaignID uuid.UUID) (db.KnowledgePool, error) {
	pool, err := s.queries.GetPartyPool(ctx, campaignID)
	if err == nil {
		return pool, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.KnowledgePool{}, err
	}
	pool, err = s.queries.CreatePartyPool(ctx, campaignID)
	if err != nil && isUniqueViolation(err) {
		// Two first-submits raced; the other one won.
		return s.queries.GetPartyPool(ctx, campaignID)
	}
	return pool, err
}

// revealLocation validates the place a batch names, returning the column value
// and the place's name for the ledger. A nil id is not an error — it is a batch
// the pool alone decides. badReq is a client-facing rejection reason, empty when
// the request is good.
func (s *Server) revealLocation(ctx context.Context, campaignID uuid.UUID, id *uuid.UUID) (col pgtype.UUID, name, badReq string, err error) {
	if id == nil {
		return pgtype.UUID{}, "", "", nil
	}
	loc, err := s.queries.GetLocation(ctx, *id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgtype.UUID{}, "", "that place is not on this campaign", nil
		}
		return pgtype.UUID{}, "", "", err
	}
	if loc.CampaignID != campaignID {
		return pgtype.UUID{}, "", "that place is not on this campaign", nil
	}
	return pgUUID(*id), loc.Name, "", nil
}

// playerRevealCircles is the one place a player's uncovered ground is decided,
// shared by the JSON map and the composited image so the two can never drift
// into disagreeing about what this viewer may see.
//
// Both gates apply: the pool query has already dropped batches from pools this
// user is not in, and every batch that names a place is then held against that
// place's veil, resolved through the viewer's own heroes and every place above
// it — hiding a country hides the cities inside it here exactly as it does on
// the quest board.
func (s *Server) playerRevealCircles(ctx context.Context, mapID, campaignID, userID uuid.UUID) ([]circleGeom, error) {
	rows, err := s.queries.ListVisibleRevealCircles(ctx, db.ListVisibleRevealCirclesParams{
		MapID:  mapID,
		UserID: userID,
	})
	if err != nil {
		return nil, err
	}

	// The veil costs three queries; a map whose batches name no place — every
	// map that predates #191 — should not pay for it.
	needVeil := false
	for _, c := range rows {
		if c.LocationID.Valid {
			needVeil = true
			break
		}
	}
	var v *veil
	var charIDs []uuid.UUID
	if needVeil {
		if v, err = s.loadVeil(ctx, campaignID); err != nil {
			return nil, err
		}
		if charIDs, err = s.seatedCharacterIDs(ctx, campaignID, userID); err != nil {
			return nil, err
		}
	}
	return filterRevealCircles(rows, v, charIDs), nil
}

// filterRevealCircles is the place gate itself, over a candidate set the pool
// query has already narrowed. A circle in no place is kept; a circle in a place
// survives only if one of the viewer's heroes may see that place.
func filterRevealCircles(rows []db.ListVisibleRevealCirclesRow, v *veil, charIDs []uuid.UUID) []circleGeom {
	out := make([]circleGeom, 0, len(rows))
	for _, c := range rows {
		if c.LocationID.Valid {
			// No veil loaded means no batch claimed a place; one that does
			// while unresolvable is fog, not a gap to fall through.
			if v == nil || !v.locationVisibleToAny(uuid.UUID(c.LocationID.Bytes), charIDs) {
				continue
			}
		}
		out = append(out, circleGeom{X: c.X, Y: c.Y, R: c.R})
	}
	return out
}

// toAPIRevealBatch renders one line of the DM's ledger.
func toAPIRevealBatch(b db.ListRevealBatchesRow) api.RevealBatch {
	out := api.RevealBatch{
		Id:           b.ID,
		Note:         b.Note,
		PoolName:     b.PoolName,
		LocationName: &b.LocationName,
		Circles:      int(b.Circles),
		CreatedAt:    b.CreatedAt.Time,
	}
	if b.LocationID.Valid {
		id := uuid.UUID(b.LocationID.Bytes)
		out.LocationId = &id
	}
	return out
}

// ListReveals returns the DM's ledger of batches on a map.
func (s *Server) ListReveals(ctx context.Context, request api.ListRevealsRequestObject) (api.ListRevealsResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ListReveals404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListReveals401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListReveals403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	rows, err := s.queries.ListRevealBatches(ctx, request.MapId)
	if err != nil {
		return nil, err
	}
	out := make([]api.RevealBatch, 0, len(rows))
	for _, b := range rows {
		out = append(out, toAPIRevealBatch(b))
	}
	return api.ListReveals200JSONResponse(out), nil
}

// SubmitReveals commits a stamped draft as one batch in the party pool.
func (s *Server) SubmitReveals(ctx context.Context, request api.SubmitRevealsRequestObject) (api.SubmitRevealsResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SubmitReveals404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SubmitReveals401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SubmitReveals403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if len(request.Body.Circles) == 0 {
		return api.SubmitReveals400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "nothing stamped — the draft is empty"}}, nil
	}
	xs := make([]float64, 0, len(request.Body.Circles))
	ys := make([]float64, 0, len(request.Body.Circles))
	rs := make([]float64, 0, len(request.Body.Circles))
	for _, c := range request.Body.Circles {
		if c.X < 0 || c.X > 1 || c.Y < 0 || c.Y > 1 {
			return api.SubmitReveals400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "circle centers are fractions of the map, 0 to 1"}}, nil
		}
		if c.R <= 0 || c.R > 1 {
			return api.SubmitReveals400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "circle radius must be a fraction of the width, above 0 and at most 1"}}, nil
		}
		xs = append(xs, float64(c.X))
		ys = append(ys, float64(c.Y))
		rs = append(rs, float64(c.R))
	}
	note := ""
	if request.Body.Note != nil {
		note = *request.Body.Note
	}
	locID, locName, badReq, err := s.revealLocation(ctx, meta.CampaignID, request.Body.LocationId)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SubmitReveals400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}

	pool, err := s.partyPool(ctx, meta.CampaignID)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	batch, err := qtx.CreateRevealBatch(ctx, db.CreateRevealBatchParams{
		MapID:      request.MapId,
		PoolID:     pool.ID,
		Note:       note,
		LocationID: locID,
	})
	if err != nil {
		return nil, err
	}
	if err := qtx.AddRevealCircles(ctx, db.AddRevealCirclesParams{
		BatchID: batch.ID,
		Column2: xs,
		Column3: ys,
		Column4: rs,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	s.publish(meta.CampaignID, live.TopicMap)
	return api.SubmitReveals201JSONResponse(api.RevealBatch{
		Id:           batch.ID,
		Note:         batch.Note,
		PoolName:     pool.Name,
		LocationId:   request.Body.LocationId,
		LocationName: &locName,
		Circles:      len(xs),
		CreatedAt:    batch.CreatedAt.Time,
	}), nil
}

// SetRevealLocation re-hangs a batch on a place, or cuts it loose. Its own
// endpoint rather than a re-stamp: the circles are the DM's drawing, and
// deciding later that the eastern road was really "knowledge of Vale" should
// not mean drawing it twice.
func (s *Server) SetRevealLocation(ctx context.Context, request api.SetRevealLocationRequestObject) (api.SetRevealLocationResponseObject, error) {
	row, err := s.queries.GetRevealBatch(ctx, request.BatchId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetRevealLocation404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetRevealLocation401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetRevealLocation403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.SetRevealLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "a place is required — send null to cut the batch loose",
		}}, nil
	}
	locID, _, badReq, err := s.revealLocation(ctx, row.CampaignID, request.Body.LocationId)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SetRevealLocation400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}
	if _, err := s.queries.SetRevealBatchLocation(ctx, db.SetRevealBatchLocationParams{
		ID:         request.BatchId,
		LocationID: locID,
	}); err != nil {
		return nil, err
	}

	// Read the ledger back rather than assembling the answer: the batch's
	// circle count lives in that query and nowhere else.
	batches, err := s.queries.ListRevealBatches(ctx, row.MapID)
	if err != nil {
		return nil, err
	}
	s.publish(row.CampaignID, live.TopicMap)
	for _, b := range batches {
		if b.ID == request.BatchId {
			return api.SetRevealLocation200JSONResponse(toAPIRevealBatch(b)), nil
		}
	}
	return api.SetRevealLocation404JSONResponse{NotFoundJSONResponse: notFound()}, nil
}

// DeleteReveals tears a batch out of the ledger; its circles fog over again.
func (s *Server) DeleteReveals(ctx context.Context, request api.DeleteRevealsRequestObject) (api.DeleteRevealsResponseObject, error) {
	row, err := s.queries.GetRevealBatch(ctx, request.BatchId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteReveals404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteReveals401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteReveals403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteRevealBatch(ctx, request.BatchId); err != nil {
		return nil, err
	}
	s.publish(row.CampaignID, live.TopicMap)
	return api.DeleteReveals204Response{}, nil
}
