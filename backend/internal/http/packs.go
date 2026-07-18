package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Content packs: batch import/export of a user's private homebrew. This is how
non-SRD book transcriptions travel between instances without ever entering
the public repo — transcribe once, export, import anywhere.
*/

var packKinds = map[string]db.ContentKind{
	"class":      db.ContentKindClass,
	"species":    db.ContentKindSpecies,
	"background": db.ContentKindBackground,
	"subclass":   db.ContentKindSubclass,
	"feat":       db.ContentKindFeat,
	"spell":      db.ContentKindSpell,
	"item":       db.ContentKindItem,
	"monster":    db.ContentKindMonster,
}

// ImportContentPack upserts every entry as the caller's homebrew, keyed by
// (kind, name). Failures are reported per entry and never abort the batch.
func (s *Server) ImportContentPack(ctx context.Context, request api.ImportContentPackRequestObject) (api.ImportContentPackResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ImportContentPack401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if request.Body == nil || len(request.Body.Entries) == 0 {
		return api.ImportContentPack400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "the pack is empty"}}, nil
	}

	report := api.ImportReport{Results: []struct {
		Error  *string                       `json:"error,omitempty"`
		Kind   string                        `json:"kind"`
		Name   string                        `json:"name"`
		Status api.ImportReportResultsStatus `json:"status"`
	}{}}

	fail := func(kind, name, msg string) {
		report.Failed++
		report.Results = append(report.Results, struct {
			Error  *string                       `json:"error,omitempty"`
			Kind   string                        `json:"kind"`
			Name   string                        `json:"name"`
			Status api.ImportReportResultsStatus `json:"status"`
		}{Kind: kind, Name: name, Status: api.ImportReportResultsStatusFailed, Error: &msg})
	}

	for _, entry := range request.Body.Entries {
		kind, ok := packKinds[string(entry.Kind)]
		name := entry.Name
		if !ok {
			fail(string(entry.Kind), name, "unknown kind")
			continue
		}
		if name == "" || len([]rune(name)) > 80 {
			fail(string(kind), name, "name must be between 1 and 80 characters")
			continue
		}
		var dataMap map[string]interface{} = entry.Data
		if dataMap == nil {
			dataMap = map[string]interface{}{}
		}
		if msg := validateContentData(kind, dataMap); msg != "" {
			fail(string(kind), name, msg)
			continue
		}
		raw, err := json.Marshal(dataMap)
		if err != nil {
			fail(string(kind), name, "unreadable data")
			continue
		}
		summary := ""
		if entry.Summary != nil {
			summary = *entry.Summary
		}
		row, err := s.queries.UpsertOwnHomebrew(ctx, db.UpsertOwnHomebrewParams{
			Kind:      kind,
			Name:      name,
			Summary:   summary,
			Data:      raw,
			CreatedBy: pgUUID(uid),
		})
		if err != nil {
			fail(string(kind), name, fmt.Sprintf("storage refused the entry: %v", err))
			continue
		}
		status := api.ImportReportResultsStatusUpdated
		if row.Created {
			status = api.ImportReportResultsStatusCreated
			report.Created++
		} else {
			report.Updated++
		}
		report.Results = append(report.Results, struct {
			Error  *string                       `json:"error,omitempty"`
			Kind   string                        `json:"kind"`
			Name   string                        `json:"name"`
			Status api.ImportReportResultsStatus `json:"status"`
		}{Kind: string(kind), Name: name, Status: status})
	}
	return api.ImportContentPack200JSONResponse(report), nil
}

// ExportContentPack returns the caller's homebrew as an importable pack.
func (s *Server) ExportContentPack(ctx context.Context, _ api.ExportContentPackRequestObject) (api.ExportContentPackResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ExportContentPack401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.ListOwnHomebrew(ctx, pgUUID(uid))
	if err != nil {
		return nil, err
	}
	entries := make([]api.PackEntry, 0, len(rows))
	for _, row := range rows {
		var data map[string]interface{}
		if err := json.Unmarshal(row.Data, &data); err != nil {
			data = map[string]interface{}{}
		}
		summary := row.Summary
		entries = append(entries, api.PackEntry{
			Kind:    api.PackEntryKind(string(row.Kind)),
			Name:    row.Name,
			Summary: &summary,
			Data:    data,
		})
	}
	return api.ExportContentPack200JSONResponse(struct {
		Entries []api.PackEntry `json:"entries"`
	}{Entries: entries}), nil
}

// SetCodexStatusBulk applies one DM verdict to many entries at once.
func (s *Server) SetCodexStatusBulk(ctx context.Context, request api.SetCodexStatusBulkRequestObject) (api.SetCodexStatusBulkResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetCodexStatusBulk401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetCodexStatusBulk403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.SetCodexStatusBulkResponseObject, error) {
		return api.SetCodexStatusBulk400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil || len(request.Body.ContentIds) == 0 {
		return badRequest("nothing to rule on")
	}

	// The same reach rule as single verdicts: SRD, the DM's own homebrew, or
	// anything already offered to this campaign.
	ids := make([]uuid.UUID, 0, len(request.Body.ContentIds))
	for _, id := range request.Body.ContentIds {
		row, err := s.queries.GetContent(ctx, uuid.UUID(id))
		if err != nil {
			return badRequest("unknown content in the verdict")
		}
		if row.Kind == db.ContentKindMonster {
			return badRequest("monsters live in the Den, not the codex")
		}
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
		ids = append(ids, row.ID)
	}

	if err := s.queries.SetCodexStatusBulk(ctx, db.SetCodexStatusBulkParams{
		CampaignID: campaignID,
		Column2:    ids,
		Status:     db.CodexStatus(string(request.Body.Status)),
		ProposedBy: pgUUID(member.UserID),
	}); err != nil {
		return nil, err
	}
	verdict := "admits"
	if request.Body.Status == "banned" {
		verdict = "bans"
	}
	s.logEvent(ctx, campaignID, member.UserID, "codex_"+string(request.Body.Status),
		fmt.Sprintf("The DM %s %d entries in one ruling", verdict, len(ids)))
	return api.SetCodexStatusBulk204Response{}, nil
}
