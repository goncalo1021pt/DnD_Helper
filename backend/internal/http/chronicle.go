package http

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
The Chronicle: a campaign's event ledger. Handlers log noteworthy moments
(quests, seats, level-ups, codex verdicts, XP, milestones) as pre-rendered
lines; the DM may write story entries between them.
*/

// logEvent records a chronicle line. Best-effort: a failed log must never
// fail the action it narrates.
func (s *Server) logEvent(ctx context.Context, campaignID, actorID uuid.UUID, kind, message string) {
	if _, err := s.queries.AddEvent(ctx, db.AddEventParams{
		CampaignID:  campaignID,
		ActorUserID: pgUUID(actorID),
		Kind:        kind,
		Message:     message,
	}); err != nil {
		log.Printf("chronicle: %s in %s: %v", kind, campaignID, err)
	}
}

func toAPIEvent(row db.ListEventsRow) api.ChronicleEvent {
	return api.ChronicleEvent{
		Id:        row.ID,
		Kind:      row.Kind,
		Message:   row.Message,
		ActorName: row.ActorName,
		CreatedAt: row.CreatedAt.Time,
	}
}

// ListEvents returns the chronicle, newest first (members).
func (s *Server) ListEvents(ctx context.Context, request api.ListEventsRequestObject) (api.ListEventsResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireMember(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListEvents401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListEvents403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	limit := int32(50)
	if request.Params.Limit != nil {
		limit = int32(*request.Params.Limit)
	}
	rows, err := s.queries.ListEvents(ctx, db.ListEventsParams{
		CampaignID: campaignID,
		Limit:      limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]api.ChronicleEvent, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAPIEvent(row))
	}
	return api.ListEvents200JSONResponse(out), nil
}

// AddChronicleNote lets the DM write a story entry.
func (s *Server) AddChronicleNote(ctx context.Context, request api.AddChronicleNoteRequestObject) (api.AddChronicleNoteResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.AddChronicleNote401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.AddChronicleNote403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil || strings.TrimSpace(request.Body.Message) == "" {
		return api.AddChronicleNote400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "the chronicle rejects empty entries"}}, nil
	}
	row, err := s.queries.AddEvent(ctx, db.AddEventParams{
		CampaignID:  campaignID,
		ActorUserID: pgUUID(member.UserID),
		Kind:        "note",
		Message:     strings.TrimSpace(request.Body.Message),
	})
	if err != nil {
		return nil, err
	}
	name, _ := s.ownerName(ctx, member.UserID)
	return api.AddChronicleNote201JSONResponse(api.ChronicleEvent{
		Id:        row.ID,
		Kind:      row.Kind,
		Message:   row.Message,
		ActorName: &name,
		CreatedAt: row.CreatedAt.Time,
	}), nil
}

// GrantXP adds (or docks) XP for chosen seated heroes — or the whole party.
func (s *Server) GrantXP(ctx context.Context, request api.GrantXPRequestObject) (api.GrantXPResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GrantXP401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GrantXP403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.GrantXPResponseObject, error) {
		return api.GrantXP400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil || request.Body.Amount == 0 {
		return badRequest("an XP grant needs a non-zero amount")
	}
	amount := request.Body.Amount

	// Resolve targets: explicit heroes, or every seated hero.
	var targets []uuid.UUID
	rows, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	seated := map[uuid.UUID]string{}
	for _, row := range rows {
		seated[row.ID] = row.Name
	}
	if request.Body.CharacterIds != nil && len(*request.Body.CharacterIds) > 0 {
		for _, id := range *request.Body.CharacterIds {
			if _, ok := seated[uuid.UUID(id)]; !ok {
				return badRequest("a chosen hero is not seated at this campaign")
			}
			targets = append(targets, uuid.UUID(id))
		}
	} else {
		for id := range seated {
			targets = append(targets, id)
		}
	}
	if len(targets) == 0 {
		return badRequest("no seated heroes to grant XP to")
	}

	updated, err := s.queries.GrantXP(ctx, db.GrantXPParams{
		CampaignID: pgUUID(campaignID),
		Xp:         int32(amount),
		Column3:    targets,
	})
	if err != nil {
		return nil, err
	}

	// One chronicle line for the grant.
	names := make([]string, 0, len(targets))
	for _, t := range targets {
		names = append(names, seated[t])
	}
	verb := "gains"
	if len(names) > 1 {
		verb = "gain"
	}
	shown := amount
	if amount < 0 {
		shown = -amount
		verb = "loses"
		if len(names) > 1 {
			verb = "lose"
		}
	}
	amountText := fmt.Sprintf("%d XP", shown)
	line := fmt.Sprintf("%s %s %s", joinNames(names), verb, amountText)
	if request.Body.Reason != nil && strings.TrimSpace(*request.Body.Reason) != "" {
		line += " — " + strings.TrimSpace(*request.Body.Reason)
	}
	s.logEvent(ctx, campaignID, member.UserID, "xp", line)

	out := make([]api.Character, 0, len(updated))
	for _, c := range updated {
		name, err := s.ownerName(ctx, c.OwnerUserID)
		if err != nil {
			return nil, err
		}
		out = append(out, toAPICharacterWithClass(c, name, member.UserID, s.classDataFor(ctx, c)))
	}
	return api.GrantXP200JSONResponse(out), nil
}

// joinNames renders "A", "A and B", or "A, B and C".
func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return "the party"
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	default:
		return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
	}
}

// DeclareMilestone grants every seated hero one pending level-up.
func (s *Server) DeclareMilestone(ctx context.Context, request api.DeclareMilestoneRequestObject) (api.DeclareMilestoneResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeclareMilestone401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeclareMilestone403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.GrantMilestone(ctx, pgUUID(campaignID)); err != nil {
		return nil, err
	}
	line := "A milestone is reached — the party may rise a level"
	if request.Body != nil && request.Body.Note != nil && strings.TrimSpace(*request.Body.Note) != "" {
		line += " — " + strings.TrimSpace(*request.Body.Note)
	}
	s.logEvent(ctx, campaignID, member.UserID, "milestone", line)
	return api.DeclareMilestone204Response{}, nil
}

// SetProgression flips the campaign between milestone and XP advancement.
func (s *Server) SetProgression(ctx context.Context, request api.SetProgressionRequestObject) (api.SetProgressionResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetProgression401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetProgression403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetProgression400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a mode is required"}}, nil
	}
	updated, err := s.queries.SetProgression(ctx, db.SetProgressionParams{
		ID:          campaignID,
		Progression: db.ProgressionMode(string(request.Body.Mode)),
	})
	if err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, member.UserID, "progression",
		fmt.Sprintf("The table now advances by %s", request.Body.Mode))
	return api.SetProgression200JSONResponse(toAPICampaign(updated)), nil
}
