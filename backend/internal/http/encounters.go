package http

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// Encounters: the DM prepares combats ahead of time, triggers them at will, and
// runs initiative. An encounter is either inactive or active, and several may be
// active at once — a party that splits into two groups is two fights on the
// board. Players get a redacted view of the one fight their own hero stands in:
// hidden combatants are dropped, enemy HP shows only as a state, and only the
// viewer's own PC exposes numbers (and can roll its own initiative).

// This file is the library: preparing a fight, filing it under the session it
// belongs to or the place it happens in, and finding it again. The rest of the
// feature sits beside it — encounters_view.go decides what each role is allowed
// to see, encounters_run.go moves a fight between prepared and running, and
// encounters_tracker.go holds the combatants and the die.

// The library's two filing axes are optional and hand-typed, so both get the
// same treatment everywhere: trimmed, length-capped, and rejected loudly rather
// than silently truncated.
const (
	maxFilingTag    = 60
	errUnknownPlace = "that place is not on this campaign's map"
)

// filingTag normalises a session tag, returning the reason it was refused.
func filingTag(tag *string) (string, string) {
	if tag == nil {
		return "", ""
	}
	t := strings.TrimSpace(*tag)
	if len([]rune(t)) > maxFilingTag {
		return "", fmt.Sprintf("a filing tag is at most %d characters", maxFilingTag)
	}
	return t, ""
}

// locationNameFor resolves the display name of the place an encounter is filed
// under. Deleting a place unfiles its encounters (ON DELETE SET NULL), so a
// dangling id is not a state that reaches here.
func (s *Server) locationNameFor(ctx context.Context, id pgtype.UUID) *string {
	if !id.Valid {
		return nil
	}
	loc, err := s.queries.GetLocation(ctx, uuid.UUID(id.Bytes))
	if err != nil {
		return nil
	}
	name := loc.Name
	return &name
}

// requireEncounterDM resolves an encounter and enforces the DM role.
func (s *Server) requireEncounterDM(ctx context.Context, encounterID uuid.UUID) (db.Encounter, error) {
	enc, err := s.queries.GetEncounter(ctx, encounterID)
	if err != nil {
		return db.Encounter{}, err
	}
	if _, err := s.requireDM(ctx, enc.CampaignID); err != nil {
		return enc, err
	}
	return enc, nil
}

// ListEncounters returns the DM's encounter library.
func (s *Server) ListEncounters(ctx context.Context, request api.ListEncountersRequestObject) (api.ListEncountersResponseObject, error) {
	if _, err := s.requireDM(ctx, request.CampaignId); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListEncounters401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListEncounters403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	rows, err := s.queries.ListEncounters(ctx, request.CampaignId)
	if err != nil {
		return nil, err
	}
	out := make([]api.Encounter, 0, len(rows))
	for _, r := range rows {
		out = append(out, encounterFromRow(db.Encounter{
			ID: r.ID, CampaignID: r.CampaignID, Name: r.Name, Status: r.Status,
			Round: r.Round, TurnIndex: r.TurnIndex, CreatedAt: r.CreatedAt,
			Tag: r.Tag, LocationID: r.LocationID,
		}, int(r.CombatantCount), r.LocationName))
	}
	return api.ListEncounters200JSONResponse(out), nil
}

// CreateEncounter prepares a new, inactive encounter.
func (s *Server) CreateEncounter(ctx context.Context, request api.CreateEncounterRequestObject) (api.CreateEncounterResponseObject, error) {
	if _, err := s.requireDM(ctx, request.CampaignId); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateEncounter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateEncounter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	name := strings.TrimSpace(request.Body.Name)
	if name == "" {
		return api.CreateEncounter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "the encounter needs a name"}}, nil
	}
	// A fight may be filed as it is prepared — under the session it belongs to,
	// the place it happens in, or neither.
	tag, msg := filingTag(request.Body.Tag)
	if msg != "" {
		return api.CreateEncounter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	locID, locName, err := s.resolveCampaignLocation(ctx, request.CampaignId, request.Body.LocationId)
	if err != nil {
		return nil, err
	}
	if request.Body.LocationId != nil && !locID.Valid {
		return api.CreateEncounter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownPlace}}, nil
	}
	enc, err := s.queries.CreateEncounter(ctx, db.CreateEncounterParams{
		CampaignID: request.CampaignId, Name: name, Tag: tag, LocationID: locID,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateEncounter201JSONResponse(encounterFromRow(enc, 0, locName)), nil
}

// GetEncounter returns full detail for the DM.
func (s *Server) GetEncounter(ctx context.Context, request api.GetEncounterRequestObject) (api.GetEncounterResponseObject, error) {
	enc, err := s.requireEncounterDM(ctx, request.EncounterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetEncounter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetEncounter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetEncounter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	detail, err := s.assembleDetail(ctx, enc, true, uid)
	if err != nil {
		return nil, err
	}
	return api.GetEncounter200JSONResponse(detail), nil
}

// FileEncounter says where a prepared fight belongs: under a session tag, in a
// place, both, or neither.
//
// This is a PUT and not part of the tracker's PATCH on purpose. The filing has
// to be clearable, and an absent field in a patch cannot be told apart from a
// null one — a DM triggering a fight would silently unpin it from its place.
// Sending the whole filing every time keeps "move it" and "unfile it" the same
// call.
func (s *Server) FileEncounter(ctx context.Context, request api.FileEncounterRequestObject) (api.FileEncounterResponseObject, error) {
	enc, err := s.requireEncounterDM(ctx, request.EncounterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.FileEncounter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.FileEncounter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.FileEncounter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	badRequest := func(msg string) (api.FileEncounterResponseObject, error) {
		return api.FileEncounter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a filing is required")
	}
	tag, msg := filingTag(request.Body.Tag)
	if msg != "" {
		return badRequest(msg)
	}
	locID, locName, err := s.resolveCampaignLocation(ctx, enc.CampaignID, request.Body.LocationId)
	if err != nil {
		return nil, err
	}
	if request.Body.LocationId != nil && !locID.Valid {
		return badRequest(errUnknownPlace)
	}

	filed, err := s.queries.FileEncounter(ctx, db.FileEncounterParams{ID: enc.ID, Tag: tag, LocationID: locID})
	if err != nil {
		return nil, err
	}
	combatants, err := s.queries.ListCombatants(ctx, filed.ID)
	if err != nil {
		return nil, err
	}
	return api.FileEncounter200JSONResponse(encounterFromRow(filed, len(combatants), locName)), nil
}

// DeleteEncounter discards an encounter and its combatants.
func (s *Server) DeleteEncounter(ctx context.Context, request api.DeleteEncounterRequestObject) (api.DeleteEncounterResponseObject, error) {
	_, err := s.requireEncounterDM(ctx, request.EncounterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteEncounter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteEncounter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteEncounter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteEncounter(ctx, request.EncounterId); err != nil {
		return nil, err
	}
	return api.DeleteEncounter204Response{}, nil
}
