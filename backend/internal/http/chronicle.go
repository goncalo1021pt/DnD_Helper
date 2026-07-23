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
		Category:  row.Category,
		Message:   row.Message,
		ActorName: row.ActorName,
		CreatedAt: row.CreatedAt.Time,
	}
}

// eventCategory derives a line's channel from its kind, mirroring the CASE in
// the ListEvents query (used for freshly written entries in the response).
func eventCategory(kind string) string {
	switch {
	case kind == "note":
		return "dm"
	case kind == "ruling", strings.HasPrefix(kind, "codex"):
		return "rules"
	case kind == "player_note":
		return "player"
	default:
		return "log"
	}
}

func validFilterCategory(c string) bool {
	switch c {
	case "all", "dm", "rules", "player", "log":
		return true
	}
	return false
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
	category := "all"
	if request.Params.Category != nil && validFilterCategory(*request.Params.Category) {
		category = *request.Params.Category
	}
	rows, err := s.queries.ListEvents(ctx, db.ListEventsParams{
		CampaignID: campaignID,
		Column2:    category,
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

// AddChronicleNote writes an entry into the chronicle. Any member may post:
// players write to player chat; the DM picks their channel — a story note (dm)
// or a ruling (rules).
func (s *Server) AddChronicleNote(ctx context.Context, request api.AddChronicleNoteRequestObject) (api.AddChronicleNoteResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
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

	// Players always post to player chat; the DM chooses story (note) or ruling.
	kind := "player_note"
	if member.Role == db.MembershipRoleDm {
		kind = "note"
		if request.Body.Category != nil && *request.Body.Category == "rules" {
			kind = "ruling"
		}
	}

	row, err := s.queries.AddEvent(ctx, db.AddEventParams{
		CampaignID:  campaignID,
		ActorUserID: pgUUID(member.UserID),
		Kind:        kind,
		Message:     strings.TrimSpace(request.Body.Message),
	})
	if err != nil {
		return nil, err
	}
	name, _ := s.ownerName(ctx, member.UserID)
	return api.AddChronicleNote201JSONResponse(api.ChronicleEvent{
		Id:        row.ID,
		Kind:      row.Kind,
		Category:  eventCategory(row.Kind),
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
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	ceiling := int32(campaignCeiling(campaign))

	line := "A milestone is reached — the party may rise a level"
	if ids, names, err := s.seatedHeroesNamed(ctx, campaignID, milestoneTargets(request.Body)); err != nil {
		return nil, err
	} else if ids != nil {
		if len(ids) == 0 {
			return api.DeclareMilestone400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "none of those heroes are seated at this table",
			}}, nil
		}
		if err := s.queries.GrantMilestoneTo(ctx, db.GrantMilestoneToParams{
			CampaignID: pgUUID(campaignID), Ceiling: ceiling, Ids: ids,
		}); err != nil {
			return nil, err
		}
		line = fmt.Sprintf("A milestone is reached for %s — they may rise a level", joinNames(names))
	} else if err := s.queries.GrantMilestone(ctx, db.GrantMilestoneParams{
		CampaignID: pgUUID(campaignID),
		Level:      ceiling,
	}); err != nil {
		return nil, err
	}
	if request.Body != nil && request.Body.Note != nil && strings.TrimSpace(*request.Body.Note) != "" {
		line += " — " + strings.TrimSpace(*request.Body.Note)
	}
	s.logEvent(ctx, campaignID, member.UserID, "milestone", line)
	return api.DeclareMilestone204Response{}, nil
}

// milestoneTargets pulls the optional characterIds out of a milestone body;
// nil means "the whole party".
func milestoneTargets(body *api.DeclareMilestoneJSONRequestBody) []uuid.UUID {
	if body == nil || body.CharacterIds == nil {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(*body.CharacterIds))
	for _, id := range *body.CharacterIds {
		ids = append(ids, uuid.UUID(id))
	}
	return ids
}

// seatedHeroesNamed filters the requested hero ids down to those actually
// seated at the campaign and returns their names for the chronicle. A nil
// request yields (nil, nil, nil) — the caller treats that as "everyone".
func (s *Server) seatedHeroesNamed(ctx context.Context, campaignID uuid.UUID, requested []uuid.UUID) ([]uuid.UUID, []string, error) {
	if requested == nil {
		return nil, nil, nil
	}
	roster, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, nil, err
	}
	nameByID := make(map[uuid.UUID]string, len(roster))
	for _, c := range roster {
		nameByID[c.ID] = c.Name
	}
	ids := make([]uuid.UUID, 0, len(requested))
	names := make([]string, 0, len(requested))
	for _, id := range requested {
		if n, ok := nameByID[id]; ok {
			ids = append(ids, id)
			names = append(names, n)
		}
	}
	return ids, names, nil
}

// RevokeMilestone takes back unspent level-ups (DM only) — from the chosen
// heroes, or one from everyone when none are named.
func (s *Server) RevokeMilestone(ctx context.Context, request api.RevokeMilestoneRequestObject) (api.RevokeMilestoneResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.RevokeMilestone401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.RevokeMilestone403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	var requested []uuid.UUID
	if request.Body != nil && request.Body.CharacterIds != nil {
		requested = make([]uuid.UUID, 0, len(*request.Body.CharacterIds))
		for _, id := range *request.Body.CharacterIds {
			requested = append(requested, uuid.UUID(id))
		}
	}
	line := "The DM takes back the party's unspent level-ups"
	if ids, names, err := s.seatedHeroesNamed(ctx, campaignID, requested); err != nil {
		return nil, err
	} else if ids != nil {
		if len(ids) == 0 {
			return api.RevokeMilestone204Response{}, nil
		}
		if err := s.queries.RevokeMilestoneFrom(ctx, db.RevokeMilestoneFromParams{
			CampaignID: pgUUID(campaignID), Ids: ids,
		}); err != nil {
			return nil, err
		}
		line = fmt.Sprintf("The DM takes back %s's unspent level-up", joinNames(names))
	} else if err := s.queries.RevokeMilestone(ctx, pgUUID(campaignID)); err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, member.UserID, "milestone", line)
	return api.RevokeMilestone204Response{}, nil
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

// SetMaxLevel sets or clears the DM's level ceiling for the table.
func (s *Server) SetMaxLevel(ctx context.Context, request api.SetMaxLevelRequestObject) (api.SetMaxLevelResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetMaxLevel401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetMaxLevel403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetMaxLevel400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a body is required"}}, nil
	}
	var ceiling *int16
	if request.Body.MaxLevel != nil {
		v := *request.Body.MaxLevel
		if v < 1 || v > 20 {
			return api.SetMaxLevel400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "the ceiling must sit between 1 and 20",
			}}, nil
		}
		l := int16(v)
		ceiling = &l
	}
	updated, err := s.queries.SetMaxLevel(ctx, db.SetMaxLevelParams{ID: campaignID, MaxLevel: ceiling})
	if err != nil {
		return nil, err
	}
	if ceiling != nil {
		s.logEvent(ctx, campaignID, member.UserID, "progression",
			fmt.Sprintf("The DM sets the table's ceiling at level %d", *ceiling))
	} else {
		s.logEvent(ctx, campaignID, member.UserID, "progression",
			"The table's ceiling returns to the standard 20")
	}
	return api.SetMaxLevel200JSONResponse(toAPICampaign(updated)), nil
}
