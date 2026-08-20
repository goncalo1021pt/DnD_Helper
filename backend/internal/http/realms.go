package http

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Realms: the ground a campaign stands on, and outlives it (#233).

A setting is authored once and played at many tables. The app already solved
that shape for players — a hero lives at the account and is SEATED into a
campaign — and the DM's setting deserves the same. This is stage one, and it is
deliberately only the container: nothing moves up, and two campaigns in one
realm see nothing whatever of each other. What it buys is the foreign key and
the mental model, so #234 can be a data migration instead of a schema
invention.

Two rules hold the shape:

  - A realm is only ever born beside a campaign. There is no door for an empty
    one, because a container with nothing in it is not something anyone sets
    out to make. It BECOMES empty, which is different, and useful: that is
    where the next campaign on this ground begins.
  - Ownership is not membership. A realm belongs to whoever made it and is
    listed, renamed, moved into and struck by them alone. What reaches the rest
    of the table is the NAME, riding on the campaign — because a table knowing
    what its setting is called is not a secret, and it is the only place a
    player ever reads it.
*/

const maxRealmName = 120

// requireRealmOwner resolves a realm and enforces that the caller made it.
//
// A realm that is not yours answers ErrNoRows rather than errForbidden, the
// way one of the Folk does: someone else's setting should not be discoverable
// by watching which ids answer differently.
func (s *Server) requireRealmOwner(ctx context.Context, realmID uuid.UUID) (db.Realm, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return db.Realm{}, errNoAuth
	}
	realm, err := s.queries.GetRealm(ctx, realmID)
	if err != nil {
		return db.Realm{}, err
	}
	if realm.OwnerUserID != uid {
		return db.Realm{}, pgx.ErrNoRows
	}
	return realm, nil
}

func toAPIRealm(r db.Realm, campaigns int64) api.Realm {
	return api.Realm{
		Id:            r.ID,
		Name:          r.Name,
		OwnerUserId:   r.OwnerUserID,
		CreatedAt:     r.CreatedAt.Time,
		CampaignCount: int(campaigns),
	}
}

// validRealmName trims and bounds a name, returning the refusal or "".
func validRealmName(raw string) (string, string) {
	name := strings.TrimSpace(raw)
	if name == "" || len([]rune(name)) > maxRealmName {
		return "", "a realm's name must be between 1 and 120 characters"
	}
	return name, ""
}

// realmOfItsOwn makes the container a campaign gets when it is founded on
// ground of its own — named after the campaign, exactly as the backfill named
// every realm that existed before this shipped.
func realmOfItsOwn(ctx context.Context, q *db.Queries, name string, uid uuid.UUID) (db.Realm, error) {
	return q.CreateRealm(ctx, db.CreateRealmParams{Name: name, OwnerUserID: uid})
}

func (s *Server) ListRealms(ctx context.Context, _ api.ListRealmsRequestObject) (api.ListRealmsResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListRealms401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.ListRealms(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.Realm, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPIRealm(db.Realm{
			ID: r.ID, Name: r.Name, OwnerUserID: r.OwnerUserID,
			CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		}, r.CampaignCount))
	}
	return api.ListRealms200JSONResponse(out), nil
}

func (s *Server) RenameRealm(ctx context.Context, request api.RenameRealmRequestObject) (api.RenameRealmResponseObject, error) {
	realm, err := s.requireRealmOwner(ctx, uuid.UUID(request.RealmId))
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.RenameRealm401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, pgx.ErrNoRows):
			return api.RenameRealm404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.RenameRealm400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a name is required"}}, nil
	}
	name, msg := validRealmName(request.Body.Name)
	if msg != "" {
		return api.RenameRealm400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	updated, err := s.queries.RenameRealm(ctx, db.RenameRealmParams{ID: realm.ID, Name: name})
	if err != nil {
		return nil, err
	}
	count, err := s.queries.CountCampaignsInRealm(ctx, updated.ID)
	if err != nil {
		return nil, err
	}
	return api.RenameRealm200JSONResponse(toAPIRealm(updated, count)), nil
}

func (s *Server) DeleteRealm(ctx context.Context, request api.DeleteRealmRequestObject) (api.DeleteRealmResponseObject, error) {
	realm, err := s.requireRealmOwner(ctx, uuid.UUID(request.RealmId))
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteRealm401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, pgx.ErrNoRows):
			return api.DeleteRealm404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	// A realm holds years of play and is never a sideways way to delete them.
	// The FK would refuse anyway; this is so the refusal has words in it.
	count, err := s.queries.CountCampaignsInRealm(ctx, realm.ID)
	if err != nil {
		return nil, err
	}
	if count > 0 {
		return api.DeleteRealm400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "campaigns still stand in this realm — move or strike them first",
		}}, nil
	}
	if _, err := s.queries.DeleteRealm(ctx, realm.ID); err != nil {
		return nil, err
	}
	return api.DeleteRealm204Response{}, nil
}

// SetCampaignRealm moves a campaign onto other ground (its owner only).
//
// Backfill gave every campaign that already existed a realm of its own, so
// without this the container would do nothing at all for the tables running
// today — there would be no way to bring two of them onto the same ground
// short of re-founding one.
func (s *Server) SetCampaignRealm(ctx context.Context, request api.SetCampaignRealmRequestObject) (api.SetCampaignRealmResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.SetCampaignRealm401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetCampaignRealm404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	// The realm is the DM's own property, not the table's, so this is the
	// owner's door rather than requireDM's — a co-DM runs the campaign, they
	// do not own the ground it stands on.
	if campaign.OwnerUserID != uid {
		return api.SetCampaignRealm403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if request.Body == nil {
		return api.SetCampaignRealm400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a realm is required"}}, nil
	}

	target := uuid.UUID(request.Body.RealmId)
	previous := campaign.RealmID

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if target == uuid.Nil {
		// Back onto ground of its own — a fresh realm named after the
		// campaign, which is exactly what founding one does by default.
		fresh, err := realmOfItsOwn(ctx, qtx, campaign.Name, uid)
		if err != nil {
			return nil, err
		}
		target = fresh.ID
	} else {
		realm, err := qtx.GetRealm(ctx, target)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return api.SetCampaignRealm404JSONResponse{NotFoundJSONResponse: notFound()}, nil
			}
			return nil, err
		}
		if realm.OwnerUserID != uid {
			return api.SetCampaignRealm404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
	}

	moved, err := qtx.SetCampaignRealm(ctx, db.SetCampaignRealmParams{ID: campaignID, RealmID: target})
	if err != nil {
		return nil, err
	}
	// The realm it just left may now be empty, and an empty realm the owner
	// never named is a container nobody made and nobody wants: it was minted
	// by the backfill or by a previous move. Sweep exactly those away, and
	// leave a named one standing — that one is a place, waiting for the next
	// campaign on this ground.
	if err := sweepUnnamedRealm(ctx, qtx, previous); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	out, err := s.campaignOut(ctx, moved, true)
	if err != nil {
		return nil, err
	}
	return api.SetCampaignRealm200JSONResponse(out), nil
}

// sweepUnnamedRealm strikes a realm that has been left empty and was never
// given a name of its own — it still carries the name of the campaign that
// minted it. A realm the owner has renamed is kept however empty it is.
func sweepUnnamedRealm(ctx context.Context, q *db.Queries, realmID uuid.UUID) error {
	realm, err := q.GetRealm(ctx, realmID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	count, err := q.CountCampaignsInRealm(ctx, realmID)
	if err != nil {
		return err
	}
	if count > 0 || realm.Named {
		return nil
	}
	_, err = q.DeleteRealm(ctx, realmID)
	return err
}
