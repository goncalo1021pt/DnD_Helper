package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
The codex is a campaign's world-truth for rules content:
  - SRD entries are legal by default; a DM may ban them (down to worlds with
    only custom classes).
  - Homebrew is invisible and illegal until its author proposes it and the DM
    enables it (or the DM enables their own directly).
*/

// codexBlocker describes one content entry keeping a hero out of a campaign.
type codexBlocker struct {
	row   db.RulesContent
	state api.SeatConflictMissingState
}

// codexBlockers returns the given content entries that are NOT legal in the
// campaign: banned SRD, or homebrew that isn't enabled.
func (s *Server) codexBlockers(ctx context.Context, campaignID uuid.UUID, contentIDs []uuid.UUID) ([]codexBlocker, error) {
	if len(contentIDs) == 0 {
		return nil, nil
	}
	statusRows, err := s.queries.GetCodexStatuses(ctx, db.GetCodexStatusesParams{
		CampaignID: campaignID,
		Column2:    contentIDs,
	})
	if err != nil {
		return nil, err
	}
	statuses := map[uuid.UUID]db.CodexStatus{}
	for _, r := range statusRows {
		statuses[r.ContentID] = r.Status
	}

	var blockers []codexBlocker
	for _, id := range contentIDs {
		row, err := s.queries.GetContent(ctx, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue // dangling reference; nothing to rule on
			}
			return nil, err
		}
		status, ruled := statuses[id]
		legal := (row.Source == db.ContentSourceSrd && (!ruled || status != db.CodexStatusBanned)) ||
			(row.Source == db.ContentSourceHomebrew && ruled && status == db.CodexStatusEnabled)
		if legal {
			continue
		}
		state := api.SeatConflictMissingStateAbsent
		if ruled && status == db.CodexStatusBanned {
			state = api.SeatConflictMissingStateBanned
		} else if ruled && status == db.CodexStatusProposed {
			state = api.SeatConflictMissingStateProposed
		}
		blockers = append(blockers, codexBlocker{row: row, state: state})
	}
	return blockers, nil
}

// seatConflictItem shapes a blocker for the seat 409 payload (the generated
// Missing element is an anonymous struct, so the type is spelled out here).
func seatConflictItem(b codexBlocker) struct {
	Id   openapi_types.UUID `json:"id"`
	Kind string             `json:"kind"`
	Name string             `json:"name"`

	// State absent = never offered; proposed = awaiting the DM; banned = the DM said no.
	State api.SeatConflictMissingState `json:"state"`
} {
	return struct {
		Id   openapi_types.UUID `json:"id"`
		Kind string             `json:"kind"`
		Name string             `json:"name"`

		// State absent = never offered; proposed = awaiting the DM; banned = the DM said no.
		State api.SeatConflictMissingState `json:"state"`
	}{Id: b.row.ID, Kind: string(b.row.Kind), Name: b.row.Name, State: b.state}
}

// sheetContentIDs collects a hero's rules references.
func sheetContentIDs(c db.Character) []uuid.UUID {
	var ids []uuid.UUID
	for _, u := range []pgtype.UUID{c.ClassID, c.SpeciesID, c.BackgroundID, c.SubclassID} {
		if u.Valid {
			ids = append(ids, uuid.UUID(u.Bytes))
		}
	}
	return ids
}

// GetCodex lists every explicit ruling and proposal for a campaign (members).
func (s *Server) GetCodex(ctx context.Context, request api.GetCodexRequestObject) (api.GetCodexResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireMember(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetCodex401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetCodex403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	uid, _ := auth.UserID(ctx)
	rows, err := s.queries.ListCodex(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out := make([]api.CodexEntry, 0, len(rows))
	for _, row := range rows {
		content := toAPIRulesContent(db.RulesContent{
			ID: row.ContentID, Kind: row.Kind, Source: row.Source,
			Name: row.Name, Summary: row.Summary, Data: row.Data,
			CreatedBy: row.CreatedBy,
		}, row.ProposerName, uid)
		out = append(out, api.CodexEntry{
			Content:      content,
			Status:       api.CodexEntryStatus(string(row.Status)),
			ProposerName: row.ProposerName,
		})
	}
	return api.GetCodex200JSONResponse(out), nil
}

// ProposeCodexContent lets a member offer their own homebrew to the table.
func (s *Server) ProposeCodexContent(ctx context.Context, request api.ProposeCodexContentRequestObject) (api.ProposeCodexContentResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ProposeCodexContent401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ProposeCodexContent403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.ProposeCodexContentResponseObject, error) {
		return api.ProposeCodexContent400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil || len(request.Body.ContentIds) == 0 {
		return badRequest("nothing to propose")
	}
	for _, id := range request.Body.ContentIds {
		row, err := s.queries.GetContent(ctx, uuid.UUID(id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return badRequest("unknown content in the proposal")
			}
			return nil, err
		}
		if row.Source != db.ContentSourceHomebrew {
			return badRequest(row.Name + " is SRD — it needs no proposal")
		}
		if !row.CreatedBy.Valid || uuid.UUID(row.CreatedBy.Bytes) != member.UserID {
			return badRequest("only the author may offer " + row.Name)
		}
		if err := s.queries.ProposeCodexContent(ctx, db.ProposeCodexContentParams{
			CampaignID: campaignID,
			ContentID:  row.ID,
			ProposedBy: pgUUID(member.UserID),
		}); err != nil {
			return nil, err
		}
	}
	return api.ProposeCodexContent204Response{}, nil
}

// SetCodexStatus is the DM's verdict: enable homebrew, ban or unban anything.
func (s *Server) SetCodexStatus(ctx context.Context, request api.SetCodexStatusRequestObject) (api.SetCodexStatusResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetCodexStatus401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetCodexStatus403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.SetCodexStatusResponseObject, error) {
		return api.SetCodexStatus400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a verdict body is required")
	}
	row, err := s.queries.GetContent(ctx, request.ContentId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetCodexStatus404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}

	// A DM may rule on SRD, their own homebrew, or anything already offered
	// to this campaign — but cannot conjure a stranger's private homebrew.
	if row.Source == db.ContentSourceHomebrew {
		mine := row.CreatedBy.Valid && uuid.UUID(row.CreatedBy.Bytes) == member.UserID
		if !mine {
			statuses, err := s.queries.GetCodexStatuses(ctx, db.GetCodexStatusesParams{
				CampaignID: campaignID,
				Column2:    []uuid.UUID{row.ID},
			})
			if err != nil {
				return nil, err
			}
			if len(statuses) == 0 {
				return badRequest(row.Name + " has not been offered to this table")
			}
		}
	}

	if err := s.queries.SetCodexStatus(ctx, db.SetCodexStatusParams{
		CampaignID: campaignID,
		ContentID:  row.ID,
		Status:     db.CodexStatus(string(request.Body.Status)),
		ProposedBy: pgUUID(member.UserID),
	}); err != nil {
		return nil, err
	}
	return api.SetCodexStatus204Response{}, nil
}

// ClearCodexStatus removes a ruling: SRD returns to legal, homebrew to unseen.
func (s *Server) ClearCodexStatus(ctx context.Context, request api.ClearCodexStatusRequestObject) (api.ClearCodexStatusResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClearCodexStatus401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClearCodexStatus403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteCodexEntry(ctx, db.DeleteCodexEntryParams{
		CampaignID: campaignID,
		ContentID:  request.ContentId,
	}); err != nil {
		return nil, err
	}
	return api.ClearCodexStatus204Response{}, nil
}
