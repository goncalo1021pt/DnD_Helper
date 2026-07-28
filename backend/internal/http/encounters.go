package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

// Encounters: the DM prepares combats ahead of time, triggers them at will, and
// runs initiative. An encounter is either inactive or active, and several may be
// active at once — a party that splits into two groups is two fights on the
// board. Players get a redacted view of the one fight their own hero stands in:
// hidden combatants are dropped, enemy HP shows only as a state, and only the
// viewer's own PC exposes numbers (and can roll its own initiative).

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

// encounterFromRow shapes one library entry. locationName is the display name
// of the place it is filed under, looked up by the caller (the list query joins
// it; single-encounter paths resolve it) — nil when it is filed nowhere.
func encounterFromRow(e db.Encounter, count int, locationName *string) api.Encounter {
	out := api.Encounter{
		Id:             e.ID,
		CampaignId:     e.CampaignID,
		Name:           e.Name,
		Status:         e.Status,
		Round:          int(e.Round),
		TurnIndex:      int(e.TurnIndex),
		CombatantCount: count,
		Tag:            e.Tag,
		LocationName:   locationName,
		CreatedAt:      e.CreatedAt.Time,
	}
	if e.LocationID.Valid {
		id := uuid.UUID(e.LocationID.Bytes)
		out.LocationId = &id
	}
	return out
}

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
	out.GroupId = groupIDOf(c)
	return out
}

// isCurrent decides whether a combatant is the one acting. A mob acts as a
// unit, so every member lights up when the turn lands on any of them.
//
// The Valid guards matter more than they look: an ungrouped combatant has an
// invalid (NULL) group, and NULL == NULL would make every loner in the fight
// "current" the moment the turn sat on any other loner.
func isCurrent(c db.EncounterCombatant, currentID uuid.UUID, currentGroup pgtype.UUID) bool {
	if c.ID == currentID {
		return true
	}
	return currentGroup.Valid && c.GroupID.Valid && c.GroupID.Bytes == currentGroup.Bytes
}

// groupIDOf exposes the mob a combatant belongs to, or nil when it stands
// alone. Both roles get it: the tracker folds a run of members into one entry,
// and a player seeing "Skeleton 1/2/3" should see them stacked the same way.
func groupIDOf(c db.EncounterCombatant) *uuid.UUID {
	if !c.GroupID.Valid {
		return nil
	}
	id := uuid.UUID(c.GroupID.Bytes)
	return &id
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
	out.GroupId = groupIDOf(c)
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
	var currentGroup pgtype.UUID
	if enc.Status == "active" && int(enc.TurnIndex) >= 0 && int(enc.TurnIndex) < len(combatants) {
		currentID = combatants[enc.TurnIndex].ID
		// A mob acts together, so the whole group lights up — landing the turn
		// index on any member marks all of them.
		currentGroup = combatants[enc.TurnIndex].GroupID
	}
	out := make([]api.Combatant, 0, len(combatants))
	for _, c := range combatants {
		current := isCurrent(c, currentID, currentGroup)
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
	return api.EncounterDetail{
		Encounter:  encounterFromRow(enc, len(combatants), s.locationNameFor(ctx, enc.LocationID)),
		Combatants: out,
	}, nil
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
	return api.StandDownEncounters200JSONResponse(out), nil
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

	count := 1
	if request.Body.Count != nil {
		count = *request.Body.Count
	}
	// A character is seated once; five copies of the same hero is never what
	// the DM meant. Everything else may arrive as a mob.
	if request.Body.Kind == "pc" {
		count = 1
		// One hero, one fight. Several encounters can run at once, so a hero
		// summoned into a second one would have their HP mirrored from two
		// tracker rows into a single character sheet — a heal in one battle
		// undoing a hit in the other. The DM stands the first fight down (or
		// removes them from it) before summoning them elsewhere.
		busy, err := s.queries.ListActiveCombatantsForCharacter(ctx, snap.CharacterID)
		if err != nil {
			return nil, err
		}
		for _, c := range busy {
			if c.EncounterID != enc.ID {
				return api.AddCombatant400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
					Error: fmt.Sprintf("%s is already fighting in another encounter — stand that one down first", snap.Label),
				}}, nil
			}
		}
	}
	if count < 1 || count > maxGroupSize {
		return api.AddCombatant400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: fmt.Sprintf("add between 1 and %d at a time", maxGroupSize),
		}}, nil
	}

	added, err := s.addCombatantsTx(ctx, snap, count)
	if err != nil {
		return nil, err
	}
	out := make([]api.Combatant, 0, len(added))
	for _, c := range added {
		out = append(out, combatantForDM(c, false))
	}
	return api.AddCombatant201JSONResponse(out), nil
}

// maxGroupSize caps a single add. Mirrors the stepper's ceiling in the UI, and
// keeps one fat-fingered request from stuffing a hundred rows into a fight.
const maxGroupSize = 12

// addCombatantsTx writes n combatants as one unit. n == 1 is the old behaviour
// exactly: a lone row with no group. Above that they share a group_id and get
// numbered labels ("Skeleton 1", "Skeleton 2", …), so the tracker can fold them
// into a single initiative entry that takes one turn — while each row keeps its
// own HP, which is the whole reason they stay separate rows.
//
// All-or-nothing: a mob half-written into a live fight is worse than no mob.
func (s *Server) addCombatantsTx(ctx context.Context, snap db.AddCombatantParams, n int) ([]db.EncounterCombatant, error) {
	if n == 1 {
		c, err := s.queries.AddCombatant(ctx, snap)
		if err != nil {
			return nil, err
		}
		return []db.EncounterCombatant{c}, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	groupID := pgUUID(uuid.New())
	base, basePlayer := snap.Label, snap.PlayerLabel
	out := make([]db.EncounterCombatant, 0, n)
	for i := 1; i <= n; i++ {
		member := snap
		member.GroupID = groupID
		// Number the sort order too. Every row in one transaction gets the SAME
		// created_at (now() is the transaction timestamp), so without this the
		// members tie on every sort key and Postgres may hand them back in any
		// order — the mob would reshuffle under the DM between refreshes.
		member.SortOrder = int32(i)
		member.Label = fmt.Sprintf("%s %d", base, i)
		// Only number the player-facing name if the DM set one; a blank stays
		// blank so players keep seeing "Unknown" rather than "Unknown 3".
		if basePlayer != "" {
			member.PlayerLabel = fmt.Sprintf("%s %d", basePlayer, i)
		}
		c, e := qtx.AddCombatant(ctx, member)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
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
	// One die per fighting unit: a mob of eight skeletons rolls once and moves
	// as one, the way a DM runs it at the table. Members share the result.
	rolled := map[uuid.UUID]int32{}
	for _, c := range combatants {
		if c.GroupID.Valid {
			gid := uuid.UUID(c.GroupID.Bytes)
			roll, seen := rolled[gid]
			if !seen {
				roll = rollD20() + c.InitMod
				rolled[gid] = roll
				if err := s.queries.SetGroupInitiative(ctx, db.SetGroupInitiativeParams{
					EncounterID: enc.ID, GroupID: c.GroupID, Initiative: &roll,
				}); err != nil {
					return nil, err
				}
			}
			continue
		}
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
	// Initiative belongs to the unit, not the individual: retyping it on one
	// skeleton moves the whole mob, or they would split across the order and
	// stop being one entry. HP deliberately does NOT spread — that is per
	// skeleton, and is why members stay separate rows.
	if b.Initiative != nil && row.GroupID.Valid {
		if err := s.queries.SetGroupInitiative(ctx, db.SetGroupInitiativeParams{
			EncounterID: row.EncounterID, GroupID: row.GroupID, Initiative: params.Initiative,
		}); err != nil {
			return nil, err
		}
	}
	// A PC's HP is a live mirror of the Party roster: whichever side the DM
	// edits, the other follows, so the two never drift apart mid-fight.
	if row.Kind == "pc" && row.CharacterID.Valid && (params.HpCurrent != row.HpCurrent || params.HpMax != row.HpMax) {
		if err := s.syncCharacterHP(ctx, uuid.UUID(row.CharacterID.Bytes), params.HpCurrent, params.HpMax); err != nil {
			return nil, err
		}
	}
	return api.UpdateCombatant200JSONResponse(combatantForDM(c, false)), nil
}

// syncCharacterHP mirrors a combatant's HP back onto its seated character, so
// damage taken in the tracker shows up on the Party roster too.
func (s *Server) syncCharacterHP(ctx context.Context, characterID uuid.UUID, hpCurrent, hpMax int32) error {
	ch, err := s.queries.GetCharacter(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	_, err = s.queries.UpdateCharacter(ctx, db.UpdateCharacterParams{
		ID: ch.ID, Name: ch.Name, Class: ch.Class, Level: ch.Level,
		HpCurrent: hpCurrent, HpMax: hpMax,
	})
	return err
}

// syncCombatantHP mirrors a party member's current HP into their live combatant
// row, wherever they're fighting. Keeps the Party roster and the encounter
// tracker from drifting apart mid-fight.
//
// A hero is barred from being seated in two running fights at once (see
// AddCombatant), so this normally touches exactly one row — but it walks every
// match rather than assuming, since a fight triggered around an already-seated
// hero could still produce two.
func (s *Server) syncCombatantHP(ctx context.Context, ch db.Character) error {
	seated, err := s.queries.ListActiveCombatantsForCharacter(ctx, pgUUID(ch.ID))
	if err != nil {
		return err
	}
	for _, c := range seated {
		if c.Kind != "pc" {
			continue
		}
		if c.HpCurrent == ch.HpCurrent && c.HpMax == ch.HpMax {
			continue
		}
		if _, err := s.queries.UpdateCombatant(ctx, db.UpdateCombatantParams{
			ID: c.ID, Label: c.Label, PlayerLabel: c.PlayerLabel, Initiative: c.Initiative,
			HpCurrent: ch.HpCurrent, HpMax: ch.HpMax, Ac: c.Ac, Hidden: c.Hidden,
		}); err != nil {
			return err
		}
	}
	return nil
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

// DeleteCombatantGroup clears a whole mob. Killing one skeleton is a plain
// combatant delete; this is "the summoner died, the swarm goes with it".
func (s *Server) DeleteCombatantGroup(ctx context.Context, request api.DeleteCombatantGroupRequestObject) (api.DeleteCombatantGroupResponseObject, error) {
	enc, err := s.requireEncounterDM(ctx, request.EncounterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteCombatantGroup404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteCombatantGroup401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteCombatantGroup403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	// Scoped to this encounter, so a stale group id from another fight can't
	// reach across and empty it.
	n, err := s.queries.DeleteCombatantGroup(ctx, db.DeleteCombatantGroupParams{
		EncounterID: enc.ID, GroupID: pgUUID(request.GroupId),
	})
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return api.DeleteCombatantGroup404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	return api.DeleteCombatantGroup204Response{}, nil
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
	// Rolling the die on one member rolls for the mob — it is one unit taking
	// one turn, so a single result has to cover all of them.
	if row.GroupID.Valid {
		if err := s.queries.SetGroupInitiative(ctx, db.SetGroupInitiativeParams{
			EncounterID: row.EncounterID, GroupID: row.GroupID, Initiative: &roll,
		}); err != nil {
			return nil, err
		}
	}
	if isDM {
		return api.RollCombatantInitiative200JSONResponse(combatantForDM(c, false)), nil
	}
	return api.RollCombatantInitiative200JSONResponse(combatantForPlayer(c, true, false)), nil
}
