package http

import (
	"context"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// maxLocationDepth caps how deep the place tree may nest. Depth is 0-indexed,
// so a root is 0 and the deepest allowed place is 9 — ten levels of
// region > city > district > ... which is far more map than any table needs.
const maxLocationDepth = 10

// veil answers "can this hero see that?" for a campaign's places and notices.
//
// Two layers resolve it: an entity's party-wide flag, overridden per hero when
// the DM has singled someone out. A notice additionally needs every place above
// it unveiled — hiding Porto hides everything hanging in Porto, whatever the
// individual notices say.
//
// The whole campaign's locations and overrides are small enough to resolve in
// memory, which keeps the rule in one readable place instead of a recursive CTE.
type veil struct {
	locations map[uuid.UUID]db.Location
	// entity id -> character id -> visible
	locOverrides   map[uuid.UUID]map[uuid.UUID]bool
	questOverrides map[uuid.UUID]map[uuid.UUID]bool
	// character id -> display name, for reporting overrides back to the DM
	charNames map[uuid.UUID]string
}

// loadVeil reads everything needed to resolve visibility for one campaign.
func (s *Server) loadVeil(ctx context.Context, campaignID uuid.UUID) (*veil, error) {
	locs, err := s.queries.ListLocationsByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	locVis, err := s.queries.ListLocationVisibilityByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	questVis, err := s.queries.ListQuestVisibilityByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}

	v := &veil{
		locations:      make(map[uuid.UUID]db.Location, len(locs)),
		locOverrides:   map[uuid.UUID]map[uuid.UUID]bool{},
		questOverrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames:      map[uuid.UUID]string{},
	}
	for _, l := range locs {
		v.locations[l.ID] = l
	}
	for _, r := range locVis {
		if v.locOverrides[r.LocationID] == nil {
			v.locOverrides[r.LocationID] = map[uuid.UUID]bool{}
		}
		v.locOverrides[r.LocationID][r.CharacterID] = r.Visible
		v.charNames[r.CharacterID] = r.CharacterName
	}
	for _, r := range questVis {
		if v.questOverrides[r.QuestID] == nil {
			v.questOverrides[r.QuestID] = map[uuid.UUID]bool{}
		}
		v.questOverrides[r.QuestID][r.CharacterID] = r.Visible
		v.charNames[r.CharacterID] = r.CharacterName
	}
	return v, nil
}

// resolve applies a hero's override to a party-wide flag. A zero character id
// means "no hero in particular" — a member watching without a seated hero, who
// sees exactly what the party sees.
func resolve(partyFlag bool, overrides map[uuid.UUID]bool, charID uuid.UUID) bool {
	if charID != uuid.Nil {
		if v, ok := overrides[charID]; ok {
			return v
		}
	}
	return partyFlag
}

// locationVisibleTo reports whether a place and every place above it are
// unveiled for one hero. A missing parent (deleted mid-read) or a cycle stops
// the walk rather than looping forever.
func (v *veil) locationVisibleTo(locID uuid.UUID, charID uuid.UUID) bool {
	seen := map[uuid.UUID]bool{}
	cur := locID
	for i := 0; i < maxLocationDepth+1; i++ {
		if seen[cur] {
			return false
		}
		seen[cur] = true

		loc, ok := v.locations[cur]
		if !ok {
			return false
		}
		if !resolve(loc.VisibleToParty, v.locOverrides[cur], charID) {
			return false
		}
		if !loc.ParentID.Valid {
			return true
		}
		cur = loc.ParentID.Bytes
	}
	return false
}

// questVisibleTo reports whether a notice is on one hero's board: the notice
// itself unveiled, and its place (if it hangs in one) unveiled all the way up.
func (v *veil) questVisibleTo(q db.Quest, charID uuid.UUID) bool {
	if !resolve(q.VisibleToParty, v.questOverrides[q.ID], charID) {
		return false
	}
	if !q.LocationID.Valid {
		return true
	}
	return v.locationVisibleTo(q.LocationID.Bytes, charID)
}

// visibleToAny reports whether any of the viewer's heroes can see the notice.
// A member with no seated hero is checked against the party-wide veil alone.
func (v *veil) questVisibleToAny(q db.Quest, charIDs []uuid.UUID) bool {
	if len(charIDs) == 0 {
		return v.questVisibleTo(q, uuid.Nil)
	}
	for _, id := range charIDs {
		if v.questVisibleTo(q, id) {
			return true
		}
	}
	return false
}

func (v *veil) locationVisibleToAny(locID uuid.UUID, charIDs []uuid.UUID) bool {
	if len(charIDs) == 0 {
		return v.locationVisibleTo(locID, uuid.Nil)
	}
	for _, id := range charIDs {
		if v.locationVisibleTo(locID, id) {
			return true
		}
	}
	return false
}

// depthOf counts how many places sit above this one. Returns false when the
// chain is broken or loops.
func (v *veil) depthOf(locID uuid.UUID) (int, bool) {
	seen := map[uuid.UUID]bool{}
	depth := 0
	cur := locID
	for {
		if seen[cur] {
			return 0, false
		}
		seen[cur] = true

		loc, ok := v.locations[cur]
		if !ok {
			return 0, false
		}
		if !loc.ParentID.Valid {
			return depth, true
		}
		depth++
		if depth > maxLocationDepth {
			return 0, false
		}
		cur = loc.ParentID.Bytes
	}
}

// heightBelow measures the deepest chain hanging under a place (0 for a leaf).
// Used to check a subtree still fits under the cap after being moved.
func (v *veil) heightBelow(locID uuid.UUID) int {
	children := map[uuid.UUID][]uuid.UUID{}
	for id, l := range v.locations {
		if l.ParentID.Valid {
			children[l.ParentID.Bytes] = append(children[l.ParentID.Bytes], id)
		}
	}
	var walk func(id uuid.UUID, guard int) int
	walk = func(id uuid.UUID, guard int) int {
		if guard > maxLocationDepth {
			return 0
		}
		best := 0
		for _, c := range children[id] {
			if h := walk(c, guard+1) + 1; h > best {
				best = h
			}
		}
		return best
	}
	return walk(locID, 0)
}

// isDescendant reports whether candidate sits anywhere under ancestor, which is
// how a move that would detach a subtree into a cycle gets rejected.
func (v *veil) isDescendant(candidate, ancestor uuid.UUID) bool {
	seen := map[uuid.UUID]bool{}
	cur := candidate
	for {
		if cur == ancestor {
			return true
		}
		if seen[cur] {
			return false
		}
		seen[cur] = true

		loc, ok := v.locations[cur]
		if !ok || !loc.ParentID.Valid {
			return false
		}
		cur = loc.ParentID.Bytes
	}
}

// overridesFor renders a DM-facing list of the heroes singled out on an entity.
func (v *veil) overridesFor(overrides map[uuid.UUID]bool) []api.VisibilityOverride {
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

// handoutVeil answers "may this hero look at that prop?" for a campaign's
// handouts.
//
// Its own loader rather than a fourth map on veil: a handout hangs inside
// nothing, so the ancestor walk a notice needs has no meaning here, and the
// quest board would pay for a table it never reads. What is shared is the rule
// itself — resolve() below is the same two layers the places use.
type handoutVeil struct {
	// handout id -> character id -> visible
	overrides map[uuid.UUID]map[uuid.UUID]bool
	charNames map[uuid.UUID]string
}

func (s *Server) loadHandoutVeil(ctx context.Context, campaignID uuid.UUID) (*handoutVeil, error) {
	rows, err := s.queries.ListHandoutVisibilityByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	v := &handoutVeil{
		overrides: map[uuid.UUID]map[uuid.UUID]bool{},
		charNames: map[uuid.UUID]string{},
	}
	for _, r := range rows {
		if v.overrides[r.HandoutID] == nil {
			v.overrides[r.HandoutID] = map[uuid.UUID]bool{}
		}
		v.overrides[r.HandoutID][r.CharacterID] = r.Visible
		v.charNames[r.CharacterID] = r.CharacterName
	}
	return v, nil
}

// visibleTo resolves one handout for one hero.
func (v *handoutVeil) visibleTo(handoutID uuid.UUID, partyFlag bool, charID uuid.UUID) bool {
	return resolve(partyFlag, v.overrides[handoutID], charID)
}

// visibleToAny reports whether any of a member's heroes may look at it. A
// member with no seated hero is judged by the party-wide veil alone.
func (v *handoutVeil) visibleToAny(handoutID uuid.UUID, partyFlag bool, charIDs []uuid.UUID) bool {
	if len(charIDs) == 0 {
		return v.visibleTo(handoutID, partyFlag, uuid.Nil)
	}
	for _, id := range charIDs {
		if v.visibleTo(handoutID, partyFlag, id) {
			return true
		}
	}
	return false
}

// overridesFor renders the DM-facing list of heroes singled out on a handout.
func (v *handoutVeil) overridesFor(handoutID uuid.UUID) []api.VisibilityOverride {
	out := make([]api.VisibilityOverride, 0, len(v.overrides[handoutID]))
	for charID, visible := range v.overrides[handoutID] {
		out = append(out, api.VisibilityOverride{
			CharacterId:   charID,
			CharacterName: v.charNames[charID],
			Visible:       visible,
		})
	}
	sortOverrides(out)
	return out
}

// seatedCharacterIDs lists the heroes a member has seated at a campaign. The
// DM never needs this — they see the whole board regardless.
func (s *Server) seatedCharacterIDs(ctx context.Context, campaignID, userID uuid.UUID) ([]uuid.UUID, error) {
	chars, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	var ids []uuid.UUID
	for _, c := range chars {
		if c.OwnerUserID == userID {
			ids = append(ids, c.ID)
		}
	}
	return ids, nil
}
