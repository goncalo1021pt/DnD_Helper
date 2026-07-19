package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// Fog of war, stage 1: the DM stamps reveal circles on a draft client-side
// and submits them here as batches. Every batch lands in the campaign's
// single implicit party pool; the schema already speaks pools, so split
// parties and merging are a later UI, not a rework.

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
		out = append(out, api.RevealBatch{
			Id:        b.ID,
			Note:      b.Note,
			PoolName:  b.PoolName,
			Circles:   int(b.Circles),
			CreatedAt: b.CreatedAt.Time,
		})
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
		MapID:  request.MapId,
		PoolID: pool.ID,
		Note:   note,
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

	return api.SubmitReveals201JSONResponse(api.RevealBatch{
		Id:        batch.ID,
		Note:      batch.Note,
		PoolName:  pool.Name,
		Circles:   len(xs),
		CreatedAt: batch.CreatedAt.Time,
	}), nil
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
	return api.DeleteReveals204Response{}, nil
}
