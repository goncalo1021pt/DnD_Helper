package http

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

// Encounters: the DM prepares combats ahead of time, triggers one at will, and
// runs initiative. Players get a redacted shared view — hidden combatants are
// dropped, enemy HP shows only as a state, and only the viewer's own PC exposes
// numbers (and can roll its own initiative).

func rollD20() int32 { return int32(rand.IntN(20)) + 1 }

// hpState maps hit points to the only HP cue players get for others.
func hpState(cur, max int32) string {
	switch {
	case cur <= 0:
		return "down"
	case max > 0 && cur*2 <= max:
		return "bloodied"
	default:
		return "healthy"
	}
}

func encounterFromRow(e db.Encounter, count int) api.Encounter {
	return api.Encounter{
		Id:             e.ID,
		CampaignId:     e.CampaignID,
		Name:           e.Name,
		Status:         e.Status,
		Round:          int(e.Round),
		TurnIndex:      int(e.TurnIndex),
		CombatantCount: count,
		CreatedAt:      e.CreatedAt.Time,
	}
}

func combatantForDM(c db.EncounterCombatant, current bool) api.Combatant {
	out := api.Combatant{
		Id:          c.ID,
		EncounterId: c.EncounterID,
		Kind:        c.Kind,
		Name:        c.Label,
		InitMod:     int(c.InitMod),
		HpState:     hpState(c.HpCurrent, c.HpMax),
		Hidden:      c.Hidden,
		Current:     current,
		SortOrder:   int(c.SortOrder),
	}
	pl := c.PlayerLabel
	out.PlayerLabel = &pl
	if c.ContentID.Valid {
		id := uuid.UUID(c.ContentID.Bytes)
		out.ContentId = &id
	}
	if c.CharacterID.Valid {
		id := uuid.UUID(c.CharacterID.Bytes)
		out.CharacterId = &id
	}
	if c.Initiative != nil {
		v := int(*c.Initiative)
		out.Initiative = &v
	}
	hc, hm, ac := int(c.HpCurrent), int(c.HpMax), int(c.Ac)
	out.HpCurrent, out.HpMax, out.Ac = &hc, &hm, &ac
	return out
}

func combatantForPlayer(c db.EncounterCombatant, mine, current bool) api.Combatant {
	// Players see their party's real names; enemies show the DM's reveal label.
	name := c.PlayerLabel
	if c.Kind == "pc" {
		name = c.Label
	}
	if strings.TrimSpace(name) == "" {
		name = "Unknown"
	}
	out := api.Combatant{
		Id:          c.ID,
		EncounterId: c.EncounterID,
		Kind:        c.Kind,
		Name:        name,
		InitMod:     int(c.InitMod),
		HpState:     hpState(c.HpCurrent, c.HpMax),
		Hidden:      false,
		Current:     current,
		SortOrder:   int(c.SortOrder),
	}
	if c.Initiative != nil {
		v := int(*c.Initiative)
		out.Initiative = &v
	}
	if mine {
		hc, hm, ac := int(c.HpCurrent), int(c.HpMax), int(c.Ac)
		out.HpCurrent, out.HpMax, out.Ac = &hc, &hm, &ac
		yes := true
		out.IsMine = &yes
		if c.CharacterID.Valid {
			id := uuid.UUID(c.CharacterID.Bytes)
			out.CharacterId = &id
		}
	}
	return out
}

// assembleDetail lists the combatants and renders them for the viewer's role.
func (s *Server) assembleDetail(ctx context.Context, enc db.Encounter, isDM bool, viewer uuid.UUID) (api.EncounterDetail, error) {
	combatants, err := s.queries.ListCombatants(ctx, enc.ID)
	if err != nil {
		return api.EncounterDetail{}, err
	}
	var ownerByChar map[uuid.UUID]uuid.UUID
	if !isDM {
		chars, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(enc.CampaignID))
		if err != nil {
			return api.EncounterDetail{}, err
		}
		ownerByChar = make(map[uuid.UUID]uuid.UUID, len(chars))
		for _, ch := range chars {
			ownerByChar[ch.ID] = ch.OwnerUserID
		}
	}
	// The combatant whose turn it is — indexed into the sorted order, only while
	// running. Marked per-combatant so a filtered player list still highlights
	// the right one (or none, when a hidden enemy is acting).
	var currentID uuid.UUID
	if enc.Status == "active" && int(enc.TurnIndex) >= 0 && int(enc.TurnIndex) < len(combatants) {
		currentID = combatants[enc.TurnIndex].ID
	}
	out := make([]api.Combatant, 0, len(combatants))
	for _, c := range combatants {
		current := c.ID == currentID
		if isDM {
			out = append(out, combatantForDM(c, current))
			continue
		}
		if c.Hidden {
			continue
		}
		mine := c.Kind == "pc" && c.CharacterID.Valid && ownerByChar[uuid.UUID(c.CharacterID.Bytes)] == viewer
		out = append(out, combatantForPlayer(c, mine, current))
	}
	return api.EncounterDetail{Encounter: encounterFromRow(enc, len(combatants)), Combatants: out}, nil
}

// --- encounter CRUD --------------------------------------------------------

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
		}, int(r.CombatantCount)))
	}
	return api.ListEncounters200JSONResponse(out), nil
}

// CreateEncounter prepares a new draft encounter.
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
	enc, err := s.queries.CreateEncounter(ctx, db.CreateEncounterParams{CampaignID: request.CampaignId, Name: name})
	if err != nil {
		return nil, err
	}
	return api.CreateEncounter201JSONResponse(encounterFromRow(enc, 0)), nil
}

// GetActiveEncounter returns the running encounter, redacted for players.
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
	enc, err := s.queries.GetActiveEncounter(ctx, request.CampaignId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetActiveEncounter204Response{}, nil
		}
		return nil, err
	}
	detail, err := s.assembleDetail(ctx, enc, m.Role == db.MembershipRoleDm, m.UserID)
	if err != nil {
		return nil, err
	}
	return api.GetActiveEncounter200JSONResponse(detail), nil
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
		case "draft", "active", "ended":
		default:
			return api.UpdateEncounter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "status must be draft, active, or ended"}}, nil
		}
		if *b.Status == "active" {
			// Only one runs at a time.
			if err := s.queries.EndOtherActiveEncounters(ctx, db.EndOtherActiveEncountersParams{CampaignID: enc.CampaignID, ID: enc.ID}); err != nil {
				return nil, err
			}
			// Count a run only on the draft/ended → active transition, not on
			// idempotent re-sets of an already-active encounter.
			if enc.Status != "active" {
				metrics.EncounterRun()
			}
		}
		if enc, err = s.queries.SetEncounterStatus(ctx, db.SetEncounterStatusParams{ID: enc.ID, Status: *b.Status}); err != nil {
			return nil, err
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
	return api.UpdateEncounter200JSONResponse(detail), nil
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

// --- combatants ------------------------------------------------------------

// combatantSnapshot copies a monster/PC's stats in at add-time (or takes typed
// custom values). Returns a user-facing errMsg for a bad request.
func (s *Server) combatantSnapshot(ctx context.Context, b *api.AddCombatantRequest) (snap db.AddCombatantParams, errMsg string, err error) {
	switch b.Kind {
	case "monster":
		if b.ContentId == nil {
			return snap, "a monster combatant needs a Den monster", nil
		}
		content, e := s.queries.GetContent(ctx, *b.ContentId)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return snap, "that monster is not in the Den", nil
			}
			return snap, "", e
		}
		var mf monsterFields
		_ = json.Unmarshal(content.Data, &mf)
		dex := mf.Abilities["dex"]
		if dex == 0 {
			dex = 10
		}
		snap.Label = content.Name
		snap.ContentID = pgUUID(*b.ContentId)
		snap.HpMax, snap.HpCurrent, snap.Ac = int32(mf.HP), int32(mf.HP), int32(mf.AC)
		snap.InitMod = int32(abilityMod(dex))
	case "pc":
		if b.CharacterId == nil {
			return snap, "a PC combatant needs a character", nil
		}
		ch, e := s.queries.GetCharacter(ctx, *b.CharacterId)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return snap, "that character was not found", nil
			}
			return snap, "", e
		}
		dex := 10
		if ch.Dexterity != nil {
			dex = int(*ch.Dexterity)
		}
		snap.Label = ch.Name
		snap.CharacterID = pgUUID(*b.CharacterId)
		snap.HpCurrent, snap.HpMax = ch.HpCurrent, ch.HpMax
		snap.InitMod = int32(abilityMod(dex))
		snap.Ac = int32(10 + abilityMod(dex))
	case "custom":
		label := ""
		if b.Label != nil {
			label = strings.TrimSpace(*b.Label)
		}
		if label == "" {
			return snap, "a custom combatant needs a name", nil
		}
		snap.Label = label
		snap.Ac = 10
		if b.HpMax != nil {
			snap.HpMax, snap.HpCurrent = int32(*b.HpMax), int32(*b.HpMax)
		}
		if b.Ac != nil {
			snap.Ac = int32(*b.Ac)
		}
		if b.InitMod != nil {
			snap.InitMod = int32(*b.InitMod)
		}
	default:
		return snap, "combatant kind must be monster, pc, or custom", nil
	}
	// Optional overrides applied on top.
	if b.Label != nil && strings.TrimSpace(*b.Label) != "" {
		snap.Label = strings.TrimSpace(*b.Label)
	}
	if b.PlayerLabel != nil {
		snap.PlayerLabel = *b.PlayerLabel
	}
	if b.Hidden != nil {
		snap.Hidden = *b.Hidden
	}
	return snap, "", nil
}

// AddCombatant adds a monster, PC, or custom line to an encounter.
func (s *Server) AddCombatant(ctx context.Context, request api.AddCombatantRequestObject) (api.AddCombatantResponseObject, error) {
	enc, err := s.requireEncounterDM(ctx, request.EncounterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.AddCombatant404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.AddCombatant401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.AddCombatant403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	snap, errMsg, err := s.combatantSnapshot(ctx, request.Body)
	if err != nil {
		return nil, err
	}
	if errMsg != "" {
		return api.AddCombatant400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	snap.EncounterID = enc.ID
	snap.Kind = request.Body.Kind
	c, err := s.queries.AddCombatant(ctx, snap)
	if err != nil {
		return nil, err
	}
	return api.AddCombatant201JSONResponse(combatantForDM(c, false)), nil
}

// RollInitiative rolls d20 + modifier for every combatant at once.
func (s *Server) RollInitiative(ctx context.Context, request api.RollInitiativeRequestObject) (api.RollInitiativeResponseObject, error) {
	enc, err := s.requireEncounterDM(ctx, request.EncounterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.RollInitiative404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.RollInitiative401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.RollInitiative403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	combatants, err := s.queries.ListCombatants(ctx, enc.ID)
	if err != nil {
		return nil, err
	}
	for _, c := range combatants {
		roll := rollD20() + c.InitMod
		if _, err := s.queries.SetCombatantInitiative(ctx, db.SetCombatantInitiativeParams{ID: c.ID, Initiative: &roll}); err != nil {
			return nil, err
		}
	}
	uid, _ := auth.UserID(ctx)
	detail, err := s.assembleDetail(ctx, enc, true, uid)
	if err != nil {
		return nil, err
	}
	return api.RollInitiative200JSONResponse(detail), nil
}

// UpdateCombatant edits a combatant (DM only): HP, initiative, reveal, rename.
func (s *Server) UpdateCombatant(ctx context.Context, request api.UpdateCombatantRequestObject) (api.UpdateCombatantResponseObject, error) {
	row, err := s.queries.GetCombatant(ctx, request.CombatantId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateCombatant404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateCombatant401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateCombatant403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	b := request.Body
	params := db.UpdateCombatantParams{
		ID:          row.ID,
		Label:       row.Label,
		PlayerLabel: row.PlayerLabel,
		Initiative:  row.Initiative,
		HpCurrent:   row.HpCurrent,
		HpMax:       row.HpMax,
		Ac:          row.Ac,
		Hidden:      row.Hidden,
	}
	if b.Label != nil {
		params.Label = strings.TrimSpace(*b.Label)
	}
	if b.PlayerLabel != nil {
		params.PlayerLabel = *b.PlayerLabel
	}
	if b.Initiative != nil {
		v := int32(*b.Initiative)
		params.Initiative = &v
	}
	if b.HpCurrent != nil {
		params.HpCurrent = int32(*b.HpCurrent)
	}
	if b.HpMax != nil {
		params.HpMax = int32(*b.HpMax)
	}
	if b.Ac != nil {
		params.Ac = int32(*b.Ac)
	}
	if b.Hidden != nil {
		params.Hidden = *b.Hidden
	}
	c, err := s.queries.UpdateCombatant(ctx, params)
	if err != nil {
		return nil, err
	}
	return api.UpdateCombatant200JSONResponse(combatantForDM(c, false)), nil
}

// DeleteCombatant removes a combatant.
func (s *Server) DeleteCombatant(ctx context.Context, request api.DeleteCombatantRequestObject) (api.DeleteCombatantResponseObject, error) {
	row, err := s.queries.GetCombatant(ctx, request.CombatantId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteCombatant404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteCombatant401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteCombatant403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteCombatant(ctx, request.CombatantId); err != nil {
		return nil, err
	}
	return api.DeleteCombatant204Response{}, nil
}

// RollCombatantInitiative rolls one combatant's initiative. The DM may roll any;
// a player may roll their own PC.
func (s *Server) RollCombatantInitiative(ctx context.Context, request api.RollCombatantInitiativeRequestObject) (api.RollCombatantInitiativeResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.RollCombatantInitiative401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	row, err := s.queries.GetCombatant(ctx, request.CombatantId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.RollCombatantInitiative404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	membership, err := s.requireMember(ctx, row.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.RollCombatantInitiative401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.RollCombatantInitiative403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	isDM := membership.Role == db.MembershipRoleDm
	mine := false
	if row.Kind == "pc" && row.CharacterID.Valid {
		ch, err := s.queries.GetCharacter(ctx, uuid.UUID(row.CharacterID.Bytes))
		if err == nil && ch.OwnerUserID == uid {
			mine = true
		}
	}
	if !isDM && !mine {
		return api.RollCombatantInitiative403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	roll := rollD20() + row.InitMod
	c, err := s.queries.SetCombatantInitiative(ctx, db.SetCombatantInitiativeParams{ID: row.ID, Initiative: &roll})
	if err != nil {
		return nil, err
	}
	if isDM {
		return api.RollCombatantInitiative200JSONResponse(combatantForDM(c, false)), nil
	}
	return api.RollCombatantInitiative200JSONResponse(combatantForPlayer(c, true, false)), nil
}
