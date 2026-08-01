package http

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// What each role is allowed to see of a fight.
//
// The DM sees the board. A player sees only the one fight their own hero stands
// in, and sees it redacted: hidden combatants are dropped entirely, enemy HP is
// flattened to a state, and numbers belong to nobody but their own PC.
//
// This is the only part of encounters that decides what leaves the server,
// which is why it is the part carrying unit tests. A redaction bug is invisible
// from the DM's screen — the only symptom is a player knowing something they
// were never meant to.

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
