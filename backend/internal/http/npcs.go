package http

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
The people of a campaign, and who has been told about them (#215).

An NPC is prep, like a shop: the DM drafts a town's worth of faces at home and
the party meets them at the table. So a person is filed under a place the same
way a shop is — and veiled the way a quest is, because knowing someone exists
is exactly the kind of knowledge the DM hands out deliberately: a party-wide
flag, per-hero exceptions, and the place tree above having the final word.
Hiding Porto hides everyone who lives there.

What stands behind a person is a second, separate veil. The party can know the
harbourmaster for weeks before anyone may read her stat block — and the ranger
who sized her up may read it while the rest only know her name. The stats
themselves are either a Den monster (contentId) or a full character sheet
(characterId), never both.

Like the shops, the filtering happens on the way out and never as a flag the
client is trusted to respect: a player is not sent a hidden person with
`visible: false`, they are not sent them at all — and a visible person whose
stats are veiled carries no statBlock and no characterId rather than a locked
one.
*/

const maxNpcName = 80

// npcVeil answers "may this hero know that person?" and, separately, "may they
// read their numbers?". Its own loader rather than more maps on veil, for the
// same reason handouts have one: the quest board should not pay for tables it
// never reads. What is shared is the rule itself — resolve() — plus the place
// walk, which is borrowed from the campaign veil at the call site.
type npcVeil struct {
	// npc id -> character id -> visible
	overrides     map[uuid.UUID]map[uuid.UUID]bool
	statOverrides map[uuid.UUID]map[uuid.UUID]bool
	charNames     map[uuid.UUID]string
}

func (s *Server) loadNpcVeil(ctx context.Context, campaignID uuid.UUID) (*npcVeil, error) {
	rows, err := s.queries.ListNpcVisibilityByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	statRows, err := s.queries.ListNpcStatVisibilityByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	v := &npcVeil{
		overrides:     map[uuid.UUID]map[uuid.UUID]bool{},
		statOverrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames:     map[uuid.UUID]string{},
	}
	for _, r := range rows {
		if v.overrides[r.NpcID] == nil {
			v.overrides[r.NpcID] = map[uuid.UUID]bool{}
		}
		v.overrides[r.NpcID][r.CharacterID] = r.Visible
		v.charNames[r.CharacterID] = r.CharacterName
	}
	for _, r := range statRows {
		if v.statOverrides[r.NpcID] == nil {
			v.statOverrides[r.NpcID] = map[uuid.UUID]bool{}
		}
		v.statOverrides[r.NpcID][r.CharacterID] = r.Visible
		v.charNames[r.CharacterID] = r.CharacterName
	}
	return v, nil
}

// npcVisibleTo resolves one person for one hero: the person's own two layers,
// then every place above them. A person filed nowhere is judged on their own
// veil alone.
//
// A traveler steps out of the PLACE tree and nothing else (#228). They walk
// with the party, so the place they are *filed* under is where they are from
// rather than where they are, and a veiled home town would otherwise hide the
// man riding beside the cart. Their own veil still rules them completely: the
// DM can send someone along and keep them a secret, or let one hero notice the
// stranger the rest walk past. Marking a person as traveling opens the
// party-wide veil once, as a convenience, but it never overrides it — a switch
// that cannot say no is not a switch.
func (v *npcVeil) npcVisibleTo(n db.Npc, places *veil, charID uuid.UUID) bool {
	if !resolve(n.VisibleToParty, v.overrides[n.ID], charID) {
		return false
	}
	if n.Traveling || !n.LocationID.Valid {
		return true
	}
	return places.locationVisibleTo(n.LocationID.Bytes, charID)
}

// npcVisibleToAny reports whether any of the viewer's heroes knows the person.
// A member with no seated hero is judged by the party-wide veil alone.
func (v *npcVeil) npcVisibleToAny(n db.Npc, places *veil, charIDs []uuid.UUID) bool {
	if len(charIDs) == 0 {
		return v.npcVisibleTo(n, places, uuid.Nil)
	}
	for _, id := range charIDs {
		if v.npcVisibleTo(n, places, id) {
			return true
		}
	}
	return false
}

// statsVisibleTo is the second veil, and it only ever opens where the first
// has: a hero who does not know the person cannot read their numbers, whatever
// the stats veil says.
func (v *npcVeil) statsVisibleTo(n db.Npc, places *veil, charID uuid.UUID) bool {
	if !v.npcVisibleTo(n, places, charID) {
		return false
	}
	return resolve(n.StatsVisibleToParty, v.statOverrides[n.ID], charID)
}

func (v *npcVeil) statsVisibleToAny(n db.Npc, places *veil, charIDs []uuid.UUID) bool {
	if len(charIDs) == 0 {
		return v.statsVisibleTo(n, places, uuid.Nil)
	}
	for _, id := range charIDs {
		if v.statsVisibleTo(n, places, id) {
			return true
		}
	}
	return false
}

// overridesFor renders a DM-facing list of the heroes singled out on a person.
func (v *npcVeil) overridesFor(overrides map[uuid.UUID]bool) []api.VisibilityOverride {
	out := make([]api.VisibilityOverride, 0, len(overrides))
	for charID, visible := range overrides {
		out = append(out, api.VisibilityOverride{
			CharacterId:   charID,
			CharacterName: v.charNames[charID],
			Visible:       visible,
		})
	}
	sortOverrides(out)
	return out
}

// npcFromListRow rebuilds the plain row so the veil helpers take one shape
// whether the caller holds a list row or a GetNpc row.
func npcFromListRow(r db.ListNpcsRow) db.Npc {
	return db.Npc{
		ID:                  r.ID,
		CampaignID:          r.CampaignID,
		Name:                r.Name,
		Description:         r.Description,
		LocationID:          r.LocationID,
		ContentID:           r.ContentID,
		CharacterID:         r.CharacterID,
		VisibleToParty:      r.VisibleToParty,
		StatsVisibleToParty: r.StatsVisibleToParty,
		Traveling:           r.Traveling,
		HpCurrent:           r.HpCurrent,
		Control:             r.Control,
		ControlUserID:       r.ControlUserID,
	}
}

/*
Allies: the person who walks with the party (#228).

The paper practice is a line in the margin of the party page — Sildar travels
with you — present, marked, and removable, never mistaken for a PC. So an ally
is not a new kind of thing here: it is one of the Folk with a state, sitting in
its own section of the roster, counted among nobody.

Two questions have to be answered about every traveler, and both are answered
from what already stands behind them rather than from a second store:

  - what they have left. A forged body keeps its hit points on its sheet,
    which is the only place that can hold them; a person carried by a stat
    block keeps them on their own row, with the maximum read off the block
    every time (a block that is re-imported at a higher HP raises its ally
    with it, the way a companion's pool follows its level).
  - who may move them. The DM always; whoever `control` names, otherwise
    nobody. Control carries the numbers with it — you cannot play someone
    whose sheet you may not read — so it lifts the stats veil for the runner
    alone and leaves the rest of the table exactly where the DM put them.
*/

const (
	controlDM     = "dm"
	controlPlayer = "player"
	controlTable  = "table"
)

// runsAlly reports whether this viewer may move an ally's hit points and read
// what stands behind them. Nobody runs a person who is not traveling.
func runsAlly(r db.ListNpcsRow, isDM bool, viewer uuid.UUID) bool {
	if isDM {
		return true
	}
	if !r.Traveling {
		return false
	}
	switch r.Control {
	case controlTable:
		return true
	case controlPlayer:
		return r.ControlUserID.Valid && uuid.UUID(r.ControlUserID.Bytes) == viewer
	}
	return false
}

// allyHP resolves what a traveler has left and their maximum from whatever
// stands behind them. A person with nothing behind them has no bar to draw,
// which is not an error — the DM may simply not have statted them yet.
func allyHP(r db.ListNpcsRow) (current, max int, ok bool) {
	if r.CharacterID.Valid {
		if r.CharacterHpMax == nil || r.CharacterHpCurrent == nil {
			return 0, 0, false
		}
		return int(*r.CharacterHpCurrent), int(*r.CharacterHpMax), true
	}
	if r.ContentID.Valid {
		var mf monsterFields
		_ = json.Unmarshal(r.ContentData, &mf)
		if mf.HP <= 0 {
			return 0, 0, false
		}
		// NULL means untouched, so a freshly marked ally walks in at full.
		current = mf.HP
		if r.HpCurrent != nil {
			current = int(*r.HpCurrent)
		}
		return clampInt(current, 0, mf.HP), mf.HP, true
	}
	return 0, 0, false
}


// npcForViewer shapes one person for whoever is looking. showStats is decided
// by the caller — for the DM it is always true, for a player it is the second
// veil resolved through their heroes.
func npcForViewer(r db.ListNpcsRow, nv *npcVeil, isDM, showStats bool, viewer uuid.UUID) api.Npc {
	yours := runsAlly(r, isDM, viewer)
	out := api.Npc{
		Id:           r.ID,
		Name:         r.Name,
		Description:  r.Description,
		LocationName: r.LocationName,
		Traveling:    &r.Traveling,
		YoursToRun:   &yours,
		IsDM:         isDM,
	}
	// Their condition is one of their numbers, so it waits on the stats veil
	// like the rest of them. A party can be told somebody walks with them and
	// still not be told how badly they are hurt — and the DM opens that with
	// the same switch that opens the block, rather than a third one.
	if r.Traveling && showStats {
		if cur, max, ok := allyHP(r); ok {
			out.HpCurrent, out.HpMax = &cur, &max
		}
	}
	if r.LocationID.Valid {
		id := uuid.UUID(r.LocationID.Bytes)
		out.LocationId = &id
	}
	if showStats {
		if r.ContentID.Valid && r.ContentKind != nil {
			// The block travels with the person, the way an armory entry
			// travels with a shelf line — under the monster's own name.
			row := db.RulesContent{
				ID:   uuid.UUID(r.ContentID.Bytes),
				Kind: *r.ContentKind,
				Data: r.ContentData,
			}
			if r.ContentName != nil {
				row.Name = *r.ContentName
			}
			if r.ContentSource != nil {
				row.Source = *r.ContentSource
			}
			block := toAPIRulesContent(row, nil, viewer)
			if r.ContentSummary != nil {
				block.Summary = *r.ContentSummary
			}
			out.StatBlock = &block
		}
		if r.CharacterID.Valid {
			// A freeform quick-add has no sheet worth opening — the link led
			// players to an empty page (#250). The DM keeps it regardless;
			// they may be mid-forge.
			if forged, ok := r.CharacterForged.(bool); isDM || (ok && forged) {
				id := uuid.UUID(r.CharacterID.Bytes)
				out.CharacterId = &id
				out.CharacterName = r.CharacterName
			}
		}
	}
	if isDM {
		if r.ContentID.Valid {
			id := uuid.UUID(r.ContentID.Bytes)
			out.ContentId = &id
		}
		visibleToParty := r.VisibleToParty
		out.VisibleToParty = &visibleToParty
		overrides := nv.overridesFor(nv.overrides[r.ID])
		out.Visibility = &overrides
		statsVisibleToParty := r.StatsVisibleToParty
		out.StatsVisibleToParty = &statsVisibleToParty
		statOverrides := nv.overridesFor(nv.statOverrides[r.ID])
		out.StatsVisibility = &statOverrides
		control := api.NpcControl(r.Control)
		out.Control = &control
		if r.ControlUserID.Valid {
			id := uuid.UUID(r.ControlUserID.Bytes)
			out.ControlUserId = &id
		}
		out.ControlUserName = r.ControlUserName
	}
	return out
}

// loadNpcs assembles every person in a campaign for one viewer.
func (s *Server) loadNpcs(ctx context.Context, campaignID uuid.UUID, isDM bool, viewer uuid.UUID) ([]api.Npc, error) {
	rows, err := s.queries.ListNpcs(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	nv, err := s.loadNpcVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	var places *veil
	var charIDs []uuid.UUID
	if !isDM {
		if places, err = s.loadVeil(ctx, campaignID); err != nil {
			return nil, err
		}
		if charIDs, err = s.seatedCharacterIDs(ctx, campaignID, viewer); err != nil {
			return nil, err
		}
	}
	out := make([]api.Npc, 0, len(rows))
	for _, r := range rows {
		n := npcFromListRow(r)
		showStats := isDM
		if !isDM {
			// Whoever was handed an ally sees them whatever the veil says:
			// being told to run someone you cannot see is not a state worth
			// having, and it is the DM's own act either way. For everybody
			// else the veil rules, traveler or not.
			mine := runsAlly(r, false, viewer)
			if !mine && !nv.npcVisibleToAny(n, places, charIDs) {
				continue
			}
			showStats = mine || nv.statsVisibleToAny(n, places, charIDs)
		}
		out = append(out, npcForViewer(r, nv, isDM, showStats, viewer))
	}
	return out, nil
}

// oneNpc re-reads a single person after a DM's change, so every write answers
// with the same shape the list does.
func (s *Server) oneNpc(ctx context.Context, campaignID, npcID, viewer uuid.UUID) (api.Npc, error) {
	all, err := s.loadNpcs(ctx, campaignID, true, viewer)
	if err != nil {
		return api.Npc{}, err
	}
	for _, n := range all {
		if n.Id == npcID {
			return n, nil
		}
	}
	return api.Npc{}, pgx.ErrNoRows
}

// requireNpcDM resolves a person and enforces the DM role over their campaign.
//
// An authenticated caller who is not that DM gets ErrNoRows, not errForbidden:
// a hidden person must be indistinguishable from one who does not exist, and a
// 403-for-real-ids / 404-for-fake-ids split lets a player probe the id space
// (#240). Redaction means absent — here as everywhere.
func (s *Server) requireNpcDM(ctx context.Context, npcID uuid.UUID) (db.Npc, error) {
	n, err := s.queries.GetNpc(ctx, npcID)
	if err != nil {
		return db.Npc{}, err
	}
	if _, err := s.requireDM(ctx, n.CampaignID); err != nil {
		if errors.Is(err, errForbidden) {
			return db.Npc{}, pgx.ErrNoRows
		}
		return n, err
	}
	return n, nil
}

func npcName(raw string) (string, string) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", "a person needs a name"
	}
	if len([]rune(name)) > maxNpcName {
		return "", "that name is too long to go by"
	}
	return name, ""
}

const (
	errNotInDen      = "that stat block is not in your Den"
	errBothStats     = "a person carries a stat block or a sheet, never both"
	errNotNpcBody    = "that sheet is not one of this campaign's Folk — forge a body for the person instead"
	errHasBody       = "that person already has a sheet"
)

// resolveNpcStats works out what stands behind a person after an input is
// applied over what stands there now. Absent fields keep the current filing;
// the nil UUID clears one explicitly, the way the bestiary unlinks a monster;
// and setting one side clears the other, because the CHECK constraint means it
// anyway and a 500 is not an answer. The middle return is a client-facing
// rejection reason, empty when the input is good.
func (s *Server) resolveNpcStats(ctx context.Context, campaignID, dmID uuid.UUID, body *api.NpcInput, current db.Npc) (pgtype.UUID, pgtype.UUID, string, error) {
	contentID := current.ContentID
	characterID := current.CharacterID

	setContent := body.ContentId != nil && uuid.UUID(*body.ContentId) != uuid.Nil
	setCharacter := body.CharacterId != nil && uuid.UUID(*body.CharacterId) != uuid.Nil
	if setContent && setCharacter {
		return pgtype.UUID{}, pgtype.UUID{}, errBothStats, nil
	}

	if body.ContentId != nil {
		contentID = pgtype.UUID{}
		if setContent {
			rc, err := s.queries.GetContent(ctx, uuid.UUID(*body.ContentId))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return pgtype.UUID{}, pgtype.UUID{}, errNotInDen, nil
				}
				return pgtype.UUID{}, pgtype.UUID{}, "", err
			}
			// The Den's own rule: SRD, or homebrew of the DM's own making.
			mine := rc.CreatedBy.Valid && uuid.UUID(rc.CreatedBy.Bytes) == dmID
			if rc.Kind != db.ContentKindMonster || (rc.Source != db.ContentSourceSrd && !mine) {
				return pgtype.UUID{}, pgtype.UUID{}, errNotInDen, nil
			}
			contentID = pgUUID(rc.ID)
			characterID = pgtype.UUID{}
		}
	}
	if body.CharacterId != nil {
		characterID = pgtype.UUID{}
		if setCharacter {
			c, err := s.queries.GetCharacter(ctx, uuid.UUID(*body.CharacterId))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return pgtype.UUID{}, pgtype.UUID{}, errNotNpcBody, nil
				}
				return pgtype.UUID{}, pgtype.UUID{}, "", err
			}
			// A sheet makes a person statted; it never makes them a party
			// member (#227). What may stand behind a person is a body forged
			// for this campaign's Folk — never somebody's hero.
			at, ok := seatedCampaign(c)
			if !ok || at != campaignID || c.Kind != db.CharacterKindNpc {
				return pgtype.UUID{}, pgtype.UUID{}, errNotNpcBody, nil
			}
			characterID = pgUUID(c.ID)
			contentID = pgtype.UUID{}
		}
	}
	return contentID, characterID, "", nil
}

// strikeNpcBody destroys the sheet a person no longer stands behind. A body is
// forged for one of the Folk and nothing else ever points at it (#227): it is
// off the roster by kind and off its owner's shelf by kind, so a body whose
// person let go would be a row reachable from nowhere. Anything that is not a
// body — a hero somebody once attached under the old rules — is left alone.
func strikeNpcBody(ctx context.Context, q *db.Queries, id pgtype.UUID) error {
	if !id.Valid {
		return nil
	}
	c, err := q.GetCharacter(ctx, uuid.UUID(id.Bytes))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if c.Kind != db.CharacterKindNpc {
		return nil
	}
	return q.DeleteCharacter(ctx, c.ID)
}

// --- the people -------------------------------------------------------------

func (s *Server) ListNpcs(ctx context.Context, request api.ListNpcsRequestObject) (api.ListNpcsResponseObject, error) {
	m, err := s.requireMember(ctx, request.CampaignId)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListNpcs401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListNpcs403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	out, err := s.loadNpcs(ctx, request.CampaignId, m.Role == db.MembershipRoleDm, m.UserID)
	if err != nil {
		return nil, err
	}
	return api.ListNpcs200JSONResponse(out), nil
}

func (s *Server) CreateNpc(ctx context.Context, request api.CreateNpcRequestObject) (api.CreateNpcResponseObject, error) {
	m, err := s.requireDM(ctx, request.CampaignId)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateNpc401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateNpc403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.CreateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a person is required"}}, nil
	}
	name, msg := npcName(request.Body.Name)
	if msg != "" {
		return api.CreateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	locID, _, err := s.resolveCampaignLocation(ctx, request.CampaignId, request.Body.LocationId)
	if err != nil {
		return nil, err
	}
	if request.Body.LocationId != nil && !locID.Valid {
		return api.CreateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownPlace}}, nil
	}
	contentID, characterID, msg, err := s.resolveNpcStats(ctx, request.CampaignId, m.UserID, request.Body, db.Npc{})
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return api.CreateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	desc := ""
	if request.Body.Description != nil {
		desc = strings.TrimSpace(*request.Body.Description)
	}
	n, err := s.queries.CreateNpc(ctx, db.CreateNpcParams{
		CampaignID: request.CampaignId, Name: name, Description: desc,
		LocationID: locID, ContentID: contentID, CharacterID: characterID,
		CreatedBy: pgUUID(m.UserID),
	})
	if err != nil {
		return nil, err
	}
	out, err := s.oneNpc(ctx, request.CampaignId, n.ID, m.UserID)
	if err != nil {
		return nil, err
	}
	s.publish(request.CampaignId, live.TopicNpcs)
	return api.CreateNpc201JSONResponse(out), nil
}

// ForgeNpcBody gives a person a sheet of their own (#227). It used to take a
// walk through the Party page — quick-add a "party member", then come here and
// attach it — which left the tavern keeper sitting in the roster with an HP bar
// and counting as one of the DM's heroes when veils resolved. The body is made
// here, in one act, and is a body from the first moment: campaign-scoped, the
// DM's, and never a seat.
func (s *Server) ForgeNpcBody(ctx context.Context, request api.ForgeNpcBodyRequestObject) (api.ForgeNpcBodyResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ForgeNpcBody404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.ForgeNpcBody401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ForgeNpcBody403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.ForgeNpcBody400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a sheet is required"}}, nil
	}
	if n.CharacterID.Valid {
		return api.ForgeNpcBody400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errHasBody}}, nil
	}
	in, msg := validateCharacterInput(request.Body)
	if msg != "" {
		return api.ForgeNpcBody400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	uid, _ := auth.UserID(ctx)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	body, err := qtx.CreateNpcBody(ctx, db.CreateNpcBodyParams{
		CampaignID: pgUUID(n.CampaignID), OwnerUserID: uid, Name: in.name,
		Class: in.class, Level: in.level, HpCurrent: in.hpCurrent, HpMax: in.hpMax,
	})
	if err != nil {
		return nil, err
	}
	// A person carries a stat block or a sheet, never both — the sheet wins.
	if _, err := qtx.UpdateNpc(ctx, db.UpdateNpcParams{
		ID: n.ID, Name: n.Name, Description: n.Description, LocationID: n.LocationID,
		ContentID: pgtype.UUID{}, CharacterID: pgUUID(body.ID),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	out, err := s.oneNpc(ctx, n.CampaignID, n.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	return api.ForgeNpcBody201JSONResponse(out), nil
}

func (s *Server) UpdateNpc(ctx context.Context, request api.UpdateNpcRequestObject) (api.UpdateNpcResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateNpc404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateNpc401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateNpc403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a person is required"}}, nil
	}
	name, msg := npcName(request.Body.Name)
	if msg != "" {
		return api.UpdateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	// A PATCH that carries the whole filing, like a shop's: an absent
	// locationId cannot be told from a null one, and a DM renaming a person
	// should not quietly unfile them from their street.
	locID := n.LocationID
	if request.Body.LocationId != nil {
		resolved, _, err := s.resolveCampaignLocation(ctx, n.CampaignID, request.Body.LocationId)
		if err != nil {
			return nil, err
		}
		if !resolved.Valid {
			return api.UpdateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownPlace}}, nil
		}
		locID = resolved
	}
	uid, _ := auth.UserID(ctx)
	contentID, characterID, msg, err := s.resolveNpcStats(ctx, n.CampaignID, uid, request.Body, n)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return api.UpdateNpc400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	desc := n.Description
	if request.Body.Description != nil {
		desc = strings.TrimSpace(*request.Body.Description)
	}
	// A body is forged for one person and nothing else points at it, so letting
	// go of it — detaching, or putting a Den monster there instead — strikes it
	// rather than leaving a sheet reachable from nowhere (#227).
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	if _, err := qtx.UpdateNpc(ctx, db.UpdateNpcParams{
		ID: n.ID, Name: name, Description: desc,
		LocationID: locID, ContentID: contentID, CharacterID: characterID,
	}); err != nil {
		return nil, err
	}
	if n.CharacterID != characterID {
		if err := strikeNpcBody(ctx, qtx, n.CharacterID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	out, err := s.oneNpc(ctx, n.CampaignID, n.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	return api.UpdateNpc200JSONResponse(out), nil
}

func (s *Server) DeleteNpc(ctx context.Context, request api.DeleteNpcRequestObject) (api.DeleteNpcResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteNpc404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteNpc401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteNpc403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	if _, err := qtx.DeleteNpc(ctx, n.ID); err != nil {
		return nil, err
	}
	// Their sheet was theirs alone; it does not outlive them (#227).
	if err := strikeNpcBody(ctx, qtx, n.CharacterID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	return api.DeleteNpc204Response{}, nil
}

// --- walking with the party -------------------------------------------------

// SetNpcTravel marks a person as one of the party's travelers, and says who
// runs them (#228). Traveling opens the veil on their existence in the same
// stroke: an ally the party has never heard of is a contradiction. The veil on
// their numbers is deliberately left alone — the table can watch Sildar's hit
// points fall for a whole campaign without ever being handed his block.
func (s *Server) SetNpcTravel(ctx context.Context, request api.SetNpcTravelRequestObject) (api.SetNpcTravelResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetNpcTravel404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetNpcTravel401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetNpcTravel403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.SetNpcTravel400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "say whether they travel"}}, nil
	}

	// An absent control keeps whatever is there, like a shop's filing.
	control := n.Control
	if request.Body.Control != nil {
		control = string(*request.Body.Control)
	}
	var runner pgtype.UUID
	switch {
	case !request.Body.Traveling:
		// Nobody runs somebody who is not walking with the party.
		control, runner = controlDM, pgtype.UUID{}
	case control == controlPlayer:
		if request.Body.ControlUserId == nil {
			return api.SetNpcTravel400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "handing an ally to a player means naming the player",
			}}, nil
		}
		uid := uuid.UUID(*request.Body.ControlUserId)
		m, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: uid, CampaignID: n.CampaignID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return api.SetNpcTravel400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
					Error: "that player does not sit at this table",
				}}, nil
			}
			return nil, err
		}
		runner = pgUUID(m.UserID)
	case control == controlDM || control == controlTable:
		runner = pgtype.UUID{}
	default:
		return api.SetNpcTravel400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "an ally is run by the DM, one player, or the whole table",
		}}, nil
	}

	// Setting out opens the veil on their existence, because an ally nobody has
	// heard of is a contradiction — but only at the moment of setting out. A
	// DM who veils a traveler afterwards means it, and handing them to a
	// different runner must not quietly undo that (a switch that cannot say no
	// is not a switch).
	visible := n.VisibleToParty || (request.Body.Traveling && !n.Traveling)
	if _, err := s.queries.SetNpcTravel(ctx, db.SetNpcTravelParams{
		ID: n.ID, Traveling: request.Body.Traveling, Control: control,
		ControlUserID: runner, VisibleToParty: visible,
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneNpc(ctx, n.CampaignID, n.ID, uid)
	if err != nil {
		return nil, err
	}
	// The roster grows a section and the Folk page changes at once, so both
	// topics wake: an ally is a party fact as much as a world one.
	s.publish(n.CampaignID, live.TopicNpcs)
	s.publish(n.CampaignID, live.TopicParty)
	return api.SetNpcTravel200JSONResponse(out), nil
}

// SetNpcHp moves a traveling ally's hit points. This is the one door on a
// person that is not the DM's alone: whoever holds the ally moves their bar,
// and a member who does not hold them is answered as if the door were not
// there — the same rule the veils keep, so probing tells nobody anything.
func (s *Server) SetNpcHp(ctx context.Context, request api.SetNpcHpRequestObject) (api.SetNpcHpResponseObject, error) {
	n, err := s.queries.GetNpc(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetNpcHp404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	m, err := s.requireMember(ctx, n.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetNpcHp401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetNpcHp403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.SetNpcHp400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "hit points are required"}}, nil
	}
	isDM := m.Role == db.MembershipRoleDm
	rows, err := s.queries.ListNpcs(ctx, n.CampaignID)
	if err != nil {
		return nil, err
	}
	var row db.ListNpcsRow
	for _, r := range rows {
		if r.ID == n.ID {
			row = r
		}
	}
	if !runsAlly(row, isDM, m.UserID) {
		return api.SetNpcHp404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if !n.Traveling {
		return api.SetNpcHp400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "only someone walking with the party keeps hit points here",
		}}, nil
	}
	_, max, ok := allyHP(row)
	if !ok {
		return api.SetNpcHp400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "nothing stands behind them to take a wound — give them a stat block or a sheet first",
		}}, nil
	}
	next := int32(clampInt(request.Body.HpCurrent, 0, max))

	// The points land where they actually live. A body's belong to its sheet,
	// which the roster, the tracker and the sheet page all read; only a person
	// carried by a stat block keeps them on their own row.
	if n.CharacterID.Valid {
		if err := s.syncCharacterHP(ctx, uuid.UUID(n.CharacterID.Bytes), next, int32(max)); err != nil {
			return nil, err
		}
	} else if _, err := s.queries.SetNpcHp(ctx, db.SetNpcHpParams{ID: n.ID, HpCurrent: &next}); err != nil {
		return nil, err
	}

	out, err := s.npcForMember(ctx, n.CampaignID, n.ID, m)
	if err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	s.publish(n.CampaignID, live.TopicParty)
	return api.SetNpcHp200JSONResponse(out), nil
}

// npcForMember re-reads one person as this member is allowed to see them —
// oneNpc answers with the DM's shape, which is right for a DM's write and
// wrong for a player moving an ally they hold.
func (s *Server) npcForMember(ctx context.Context, campaignID, npcID uuid.UUID, m db.Membership) (api.Npc, error) {
	all, err := s.loadNpcs(ctx, campaignID, m.Role == db.MembershipRoleDm, m.UserID)
	if err != nil {
		return api.Npc{}, err
	}
	for _, n := range all {
		if n.Id == npcID {
			return n, nil
		}
	}
	return api.Npc{}, pgx.ErrNoRows
}

// --- the veils --------------------------------------------------------------

func (s *Server) SetNpcVisibility(ctx context.Context, request api.SetNpcVisibilityRequestObject) (api.SetNpcVisibilityResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetNpcVisibility404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetNpcVisibility401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetNpcVisibility403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	charID, badReq, err := s.visibilityTarget(ctx, n.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SetNpcVisibility400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}
	if charID == uuid.Nil {
		if _, err := s.queries.SetNpcPartyVisibility(ctx, db.SetNpcPartyVisibilityParams{
			ID: n.ID, VisibleToParty: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
		// Choosing the party is choosing everyone: per-hero exceptions go.
		if err := s.queries.ClearNpcOverrides(ctx, n.ID); err != nil {
			return nil, err
		}
	} else if err := s.queries.SetNpcOverride(ctx, db.SetNpcOverrideParams{
		NpcID: n.ID, CharacterID: charID, Visible: request.Body.Visible,
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneNpc(ctx, n.CampaignID, n.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	return api.SetNpcVisibility200JSONResponse(out), nil
}

func (s *Server) ClearNpcVisibilityOverride(ctx context.Context, request api.ClearNpcVisibilityOverrideRequestObject) (api.ClearNpcVisibilityOverrideResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClearNpcVisibilityOverride404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClearNpcVisibilityOverride401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClearNpcVisibilityOverride403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if err := s.queries.DeleteNpcOverride(ctx, db.DeleteNpcOverrideParams{
		NpcID: n.ID, CharacterID: uuid.UUID(request.CharacterId),
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneNpc(ctx, n.CampaignID, n.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	return api.ClearNpcVisibilityOverride200JSONResponse(out), nil
}

func (s *Server) SetNpcStatsVisibility(ctx context.Context, request api.SetNpcStatsVisibilityRequestObject) (api.SetNpcStatsVisibilityResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetNpcStatsVisibility404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetNpcStatsVisibility401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetNpcStatsVisibility403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	charID, badReq, err := s.visibilityTarget(ctx, n.CampaignID, request.Body)
	if err != nil {
		return nil, err
	}
	if badReq != "" {
		return api.SetNpcStatsVisibility400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: badReq}}, nil
	}
	if charID == uuid.Nil {
		if _, err := s.queries.SetNpcStatsPartyVisibility(ctx, db.SetNpcStatsPartyVisibilityParams{
			ID: n.ID, StatsVisibleToParty: request.Body.Visible,
		}); err != nil {
			return nil, err
		}
		if err := s.queries.ClearNpcStatOverrides(ctx, n.ID); err != nil {
			return nil, err
		}
	} else if err := s.queries.SetNpcStatOverride(ctx, db.SetNpcStatOverrideParams{
		NpcID: n.ID, CharacterID: charID, Visible: request.Body.Visible,
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneNpc(ctx, n.CampaignID, n.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	return api.SetNpcStatsVisibility200JSONResponse(out), nil
}

func (s *Server) ClearNpcStatsVisibilityOverride(ctx context.Context, request api.ClearNpcStatsVisibilityOverrideRequestObject) (api.ClearNpcStatsVisibilityOverrideResponseObject, error) {
	n, err := s.requireNpcDM(ctx, uuid.UUID(request.NpcId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClearNpcStatsVisibilityOverride404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.ClearNpcStatsVisibilityOverride401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ClearNpcStatsVisibilityOverride403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if err := s.queries.DeleteNpcStatOverride(ctx, db.DeleteNpcStatOverrideParams{
		NpcID: n.ID, CharacterID: uuid.UUID(request.CharacterId),
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneNpc(ctx, n.CampaignID, n.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(n.CampaignID, live.TopicNpcs)
	return api.ClearNpcStatsVisibilityOverride200JSONResponse(out), nil
}

// allyStats reads what a traveler brings to a fight from whatever stands
// behind them: a forged body answers off its sheet — hit points, and the AC
// the player reads there rather than 10 + DEX — and a person carried by a
// stat block answers off the block, with the points they have left rather
// than a fresh full bar (#228).
type allyCombatStats struct {
	hpCurrent, hpMax, ac, initMod int32
	ok                            bool
}

func (s *Server) allyStats(ctx context.Context, n db.Npc) (allyCombatStats, error) {
	var st allyCombatStats
	switch {
	case n.CharacterID.Valid:
		ch, err := s.queries.GetCharacter(ctx, uuid.UUID(n.CharacterID.Bytes))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return st, nil
			}
			return st, err
		}
		dex := 10
		if ch.Dexterity != nil {
			dex = int(*ch.Dexterity)
		}
		ac, err := s.heroArmorClass(ctx, ch)
		if err != nil {
			return st, err
		}
		return allyCombatStats{ch.HpCurrent, ch.HpMax, ac, int32(abilityMod(dex)), true}, nil
	case n.ContentID.Valid:
		rc, err := s.queries.GetContent(ctx, uuid.UUID(n.ContentID.Bytes))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return st, nil
			}
			return st, err
		}
		var mf monsterFields
		_ = json.Unmarshal(rc.Data, &mf)
		if mf.HP <= 0 {
			return st, nil
		}
		dex := mf.Abilities["dex"]
		if dex == 0 {
			dex = 10
		}
		cur := int32(mf.HP)
		if n.HpCurrent != nil {
			cur = int32(clampInt(int(*n.HpCurrent), 0, mf.HP))
		}
		return allyCombatStats{cur, int32(mf.HP), int32(mf.AC), int32(abilityMod(dex)), true}, nil
	}
	return st, nil
}
