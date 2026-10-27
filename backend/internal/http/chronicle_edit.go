package http

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Putting a chronicle line right (#411).

A line is one of three things, and what may be done with it follows from which:

  - a DM's story note or ruling (`note`, `ruling`) is the table's own voice, so
    any DM at the table may reword it or strike it;
  - a player's chat line (`player_note`) is their own words: they may reword
    and strike it, and a DM may strike it — moderation — but never reword it;
  - everything else is the app's record of something that happened (a level, a
    reward, a roll, a handout), which a DM may strike and nobody may reword.

Striking undoes nothing a line recorded: the XP stays granted, the handout
given. And a line the caller may not touch answers 404 rather than 403, the
way every door here refuses what is not yours to know about.
*/

const chronicleMaxRunes = 2000

// eventRights says what a member may do with one line.
func eventRights(kind string, actor pgtype.UUID, member db.Membership) (canEdit, canDelete bool) {
	isDM := member.Role == db.MembershipRoleDm
	mine := actor.Valid && uuid.UUID(actor.Bytes) == member.UserID
	switch kind {
	case "note", "ruling":
		return isDM, isDM
	case "player_note":
		return mine, mine || isDM
	default:
		return false, isDM
	}
}

// chronicleText tidies what was typed: line breaks kept and made plain, the
// ends trimmed, and no more than one blank line in a row — a paragraph break
// is a thing people mean, a screen of empty lines is not.
func chronicleText(raw string) (string, string) {
	text := strings.ReplaceAll(raw, "\r\n", "\n")
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	blank := 0
	for _, l := range lines {
		l = strings.TrimRight(l, " \t")
		if l == "" {
			blank++
			if blank > 1 {
				continue
			}
		} else {
			blank = 0
		}
		out = append(out, l)
	}
	text = strings.TrimSpace(strings.Join(out, "\n"))
	if text == "" {
		return "", "the chronicle rejects empty entries"
	}
	if utf8.RuneCountInString(text) > chronicleMaxRunes {
		return "", "an entry is at most 2,000 characters"
	}
	return text, ""
}

// eventFor resolves a line through its table and says what the caller may do
// with it; a line on another table, or none at all, is pgx.ErrNoRows.
func (s *Server) eventFor(ctx context.Context, eventID, campaignID uuid.UUID) (db.CampaignEvent, db.Membership, bool, bool, error) {
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		return db.CampaignEvent{}, member, false, false, err
	}
	row, err := s.queries.GetEventForCampaign(ctx, db.GetEventForCampaignParams{ID: eventID, CampaignID: campaignID})
	if err != nil {
		return row, member, false, false, err
	}
	canEdit, canDelete := eventRights(row.Kind, row.ActorUserID, member)
	return row, member, canEdit, canDelete, nil
}

func (s *Server) EditChronicleEntry(ctx context.Context, request api.EditChronicleEntryRequestObject) (api.EditChronicleEntryResponseObject, error) {
	campaignID := uuid.UUID(request.Params.CampaignId)
	_, member, canEdit, _, err := s.eventFor(ctx, request.EventId, campaignID)
	switch {
	case errors.Is(err, errNoAuth):
		return api.EditChronicleEntry401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	case errors.Is(err, errForbidden), errors.Is(err, pgx.ErrNoRows):
		return api.EditChronicleEntry404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	case err != nil:
		return nil, err
	}
	if !canEdit {
		return api.EditChronicleEntry404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if request.Body == nil {
		return api.EditChronicleEntry400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "the chronicle rejects empty entries"}}, nil
	}
	message, problem := chronicleText(request.Body.Message)
	if problem != "" {
		return api.EditChronicleEntry400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: problem}}, nil
	}
	row, err := s.queries.EditEventMessage(ctx, db.EditEventMessageParams{ID: request.EventId, Message: message})
	if err != nil {
		return nil, err
	}
	s.publish(campaignID, live.TopicChronicle)
	var actorName *string
	if row.ActorUserID.Valid {
		if name, err := s.ownerName(ctx, uuid.UUID(row.ActorUserID.Bytes)); err == nil {
			actorName = &name
		}
	}
	return api.EditChronicleEntry200JSONResponse(toAPIEvent(db.ListEventsRow{
		ID: row.ID, CampaignID: row.CampaignID, ActorUserID: row.ActorUserID, Kind: row.Kind,
		Message: row.Message, CreatedAt: row.CreatedAt, HandoutID: row.HandoutID, EditedAt: row.EditedAt,
		ActorName: actorName, Category: eventCategory(row.Kind),
	}, member)), nil
}

func (s *Server) DeleteChronicleEntry(ctx context.Context, request api.DeleteChronicleEntryRequestObject) (api.DeleteChronicleEntryResponseObject, error) {
	campaignID := uuid.UUID(request.Params.CampaignId)
	_, _, _, canDelete, err := s.eventFor(ctx, request.EventId, campaignID)
	switch {
	case errors.Is(err, errNoAuth):
		return api.DeleteChronicleEntry401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	case errors.Is(err, errForbidden), errors.Is(err, pgx.ErrNoRows):
		return api.DeleteChronicleEntry404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	case err != nil:
		return nil, err
	}
	if !canDelete {
		return api.DeleteChronicleEntry404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if _, err := s.queries.DeleteEvent(ctx, request.EventId); err != nil {
		return nil, err
	}
	s.publish(campaignID, live.TopicChronicle)
	return api.DeleteChronicleEntry204Response{}, nil
}
