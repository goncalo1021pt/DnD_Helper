package http

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

// The lifecycle: a prepared fight becoming a running one, and back again.
//
// Several encounters may run at once — a split party is two fights on the board
// — so triggering one does not stand the others down, and "the" active
// encounter is per-viewer rather than per-campaign.
//
// Standing down is the half worth reading: it is what makes "inactive" mean
// something, and it is all-or-nothing, because a fight that released its party
// but kept its initiative is a worse state than either end.

// GetActiveEncounter returns the running encounter this member belongs to,
// redacted for players.
//
// "The" active encounter stopped being a single thing once a split party could
// have two fights going. A player gets the one their own hero is standing in —
// the other half of the party is off having a battle that is none of their
// business, and they should not be watching its initiative order. The DM, who
// sees every fight from the library anyway, gets the most recently triggered
// one as a landing view.
func (s *Server) GetActiveEncounter(ctx context.Context, request api.GetActiveEncounterRequestObject) (api.GetActiveEncounterResponseObject, error) {
	m, err := s.requireMember(ctx, request.CampaignId)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetActiveEncounter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetActiveEncounter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	isDM := m.Role == db.MembershipRoleDm
	var enc db.Encounter
	if isDM {
		running, e := s.queries.ListActiveEncounters(ctx, request.CampaignId)
		if e != nil {
			return nil, e
		}
		if len(running) == 0 {
			return api.GetActiveEncounter204Response{}, nil
		}
		enc = running[0]
	} else {
		var e error
		enc, e = s.queries.GetActiveEncounterForUser(ctx, db.GetActiveEncounterForUserParams{
			CampaignID: request.CampaignId, OwnerUserID: m.UserID,
		})
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return api.GetActiveEncounter204Response{}, nil
			}
			return nil, e
		}
	}
	detail, err := s.assembleDetail(ctx, enc, isDM, m.UserID)
	if err != nil {
		return nil, err
	}
	return api.GetActiveEncounter200JSONResponse(detail), nil
}

// UpdateEncounter renames, triggers/ends, or advances the tracker.
func (s *Server) UpdateEncounter(ctx context.Context, request api.UpdateEncounterRequestObject) (api.UpdateEncounterResponseObject, error) {
	enc, err := s.requireEncounterDM(ctx, request.EncounterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateEncounter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateEncounter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateEncounter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	b := request.Body
	if b.Name != nil {
		name := strings.TrimSpace(*b.Name)
		if name == "" {
			return api.UpdateEncounter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "the encounter needs a name"}}, nil
		}
		if enc, err = s.queries.RenameEncounter(ctx, db.RenameEncounterParams{ID: enc.ID, Name: name}); err != nil {
			return nil, err
		}
	}
	if b.Status != nil {
		switch *b.Status {
		case "inactive", "active":
		default:
			return api.UpdateEncounter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "status must be active or inactive"}}, nil
		}
		switch {
		case *b.Status == "active":
			// Several fights may run side by side — a split party is two
			// encounters at once — so triggering one no longer stands the
			// others down. Count a run only on the inactive → active
			// transition, not on idempotent re-sets of a running encounter.
			if enc.Status != "active" {
				metrics.EncounterRun()
			}
			if enc, err = s.queries.SetEncounterStatus(ctx, db.SetEncounterStatusParams{ID: enc.ID, Status: *b.Status}); err != nil {
				return nil, err
			}
		case enc.Status == "active":
			if enc, err = s.standDown(ctx, enc); err != nil {
				return nil, err
			}
		default:
			// Already inactive — nothing to release, but keep the write so the
			// response reflects the requested state.
			if enc, err = s.queries.SetEncounterStatus(ctx, db.SetEncounterStatusParams{ID: enc.ID, Status: *b.Status}); err != nil {
				return nil, err
			}
		}
	}
	if b.Round != nil || b.TurnIndex != nil {
		round := enc.Round
		if b.Round != nil {
			round = int32(*b.Round)
		}
		turn := enc.TurnIndex
		if b.TurnIndex != nil {
			turn = int32(*b.TurnIndex)
		}
		if enc, err = s.queries.UpdateEncounterProgress(ctx, db.UpdateEncounterProgressParams{ID: enc.ID, Round: round, TurnIndex: turn}); err != nil {
			return nil, err
		}
	}
	uid, _ := auth.UserID(ctx)
	detail, err := s.assembleDetail(ctx, enc, true, uid)
	if err != nil {
		return nil, err
	}
	s.publish(enc.CampaignID, live.TopicEncounter)
	return api.UpdateEncounter200JSONResponse(detail), nil
}

// standDown takes a running encounter out of the fight and leaves it as a
// prepared one again: the summoned party is released, initiative is wiped, and
// the round counter goes back to the top.
//
// This is what makes "inactive" mean something. Before, a finished fight kept
// its heroes and their rolled initiative, so reopening it in the builder showed
// a party nobody had summoned and an order nobody had rolled — and a hero left
// behind in a stale encounter could not be summoned into the next one.
//
// All-or-nothing: an encounter that released its party but kept its initiative
// is a worse state than either end.
func (s *Server) standDown(ctx context.Context, enc db.Encounter) (db.Encounter, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return enc, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if err := qtx.ClearEncounterParty(ctx, enc.ID); err != nil {
		return enc, err
	}
	if err := qtx.ClearEncounterInitiative(ctx, enc.ID); err != nil {
		return enc, err
	}
	out, err := qtx.SetEncounterStatus(ctx, db.SetEncounterStatusParams{ID: enc.ID, Status: "inactive"})
	if err != nil {
		return enc, err
	}
	if out, err = qtx.UpdateEncounterProgress(ctx, db.UpdateEncounterProgressParams{ID: enc.ID, Round: 1, TurnIndex: 0}); err != nil {
		return enc, err
	}
	if err := tx.Commit(ctx); err != nil {
		return enc, err
	}
	return out, nil
}

// StandDownEncounters ends every running fight in a campaign at once.
//
// With several encounters open — and encounter grouping not built yet — a DM
// who has lost track of which fight still holds a player would otherwise have
// to open each one hunting for them. This releases all of them in one press.
func (s *Server) StandDownEncounters(ctx context.Context, request api.StandDownEncountersRequestObject) (api.StandDownEncountersResponseObject, error) {
	if _, err := s.requireDM(ctx, request.CampaignId); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.StandDownEncounters401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.StandDownEncounters403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	running, err := s.queries.ListActiveEncounters(ctx, request.CampaignId)
	if err != nil {
		return nil, err
	}
	out := make([]api.Encounter, 0, len(running))
	for _, enc := range running {
		stood, err := s.standDown(ctx, enc)
		if err != nil {
			return nil, err
		}
		count, err := s.queries.ListCombatants(ctx, stood.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, encounterFromRow(stood, len(count), s.locationNameFor(ctx, stood.LocationID)))
	}
	s.publish(request.CampaignId, live.TopicEncounter)
	return api.StandDownEncounters200JSONResponse(out), nil
}
