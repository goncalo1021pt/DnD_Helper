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

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

// The tracker: who is in the fight, and in what order.
//
// A mob is the idea that shapes this file. Several rows that act as one unit —
// they share a group id, roll one die between them, take one turn, and light up
// together — while keeping their own HP, which is the whole reason they stay
// separate rows rather than a count.
//
// The other recurring theme is that a seated PC's HP has two homes, the tracker
// and the Party roster, and neither is allowed to become the stale one.

func rollD20() int32 { return int32(rand.IntN(20)) + 1 }

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
		// The AC the player reads on their own sheet, not 10 + DEX — armour and
		// an Unarmored Defense used to vanish the moment a hero was summoned
		// (#153), and the DM spent the fight rolling against the wrong number.
		if snap.Ac, e = s.heroArmorClass(ctx, ch); e != nil {
			return snap, "", e
		}
	case "ally":
		// One of the Folk walking with the party (#228). The snapshot comes
		// from whatever stands behind them — a forged body reads exactly like
		// a PC, a person carried by a stat block exactly like a monster — and
		// the row keeps a link home, so the mirror knows where to put the hit
		// points back when the fight moves them.
		if b.NpcId == nil {
			return snap, "an ally combatant needs one of the Folk", nil
		}
		n, e := s.queries.GetNpc(ctx, *b.NpcId)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return snap, "that person is not at this table", nil
			}
			return snap, "", e
		}
		if !n.Traveling {
			return snap, "only someone walking with the party is seated beside it", nil
		}
		st, e := s.allyStats(ctx, n)
		if e != nil {
			return snap, "", e
		}
		if !st.ok {
			return snap, "nothing stands behind them to fight with — give them a stat block or a sheet first", nil
		}
		snap.Label = n.Name
		snap.NpcID = pgUUID(n.ID)
		snap.CharacterID = n.CharacterID
		snap.HpCurrent, snap.HpMax, snap.Ac, snap.InitMod = st.hpCurrent, st.hpMax, st.ac, st.initMod
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
		return snap, "combatant kind must be monster, pc, ally, or custom", nil
	}
	// Optional overrides applied on top.
	if b.Label != nil && strings.TrimSpace(*b.Label) != "" {
		snap.Label = strings.TrimSpace(*b.Label)
	}
	// A combatant is named to the party by default (#286). The reveal label
	// was built to let a DM say "Looming Shape" instead of "Ancient Red
	// Dragon", but it started blank and nothing ever set it, so every enemy
	// read "Unknown" for good — the veil was on with no way to lift it. Most
	// fights are "three goblins attack", so the real name is the default and
	// the mystery is the thing you ask for.
	snap.PlayerLabel = snap.Label
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
	// An ally's hit points mirror home exactly as a hero's do, so the same rule
	// holds: one of them, in one fight.
	if request.Body.Kind == "ally" {
		count = 1
		busy, err := s.queries.ListActiveCombatantsForNpc(ctx, snap.NpcID)
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
	s.publish(enc.CampaignID, live.TopicEncounter)
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
	s.publish(enc.CampaignID, live.TopicEncounter)
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
	// Both new fields are validated before anything is written, so a bad chip
	// name cannot leave the HP edit that shared its request already applied.
	conditions, condErr := combatantConditions(b)
	if condErr != "" {
		return api.UpdateCombatant400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: condErr}}, nil
	}
	saves, savesErr := combatantDeathSaves(b, row, params.HpCurrent)
	if savesErr != "" {
		return api.UpdateCombatant400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: savesErr}}, nil
	}
	c, err := s.queries.UpdateCombatant(ctx, params)
	if err != nil {
		return nil, err
	}
	if conditions != nil {
		if c, err = s.queries.SetCombatantConditions(ctx, db.SetCombatantConditionsParams{
			ID: row.ID, Conditions: conditions,
		}); err != nil {
			return nil, err
		}
	}
	// After the HP write, never before: UpdateCombatant clears the pips whenever
	// hit points rise, and a request that set both would otherwise have its
	// tally wiped by its own heal.
	if saves != nil {
		if c, err = s.queries.SetCombatantDeathSaves(ctx, db.SetCombatantDeathSavesParams{
			ID: row.ID, DeathSaveSuccesses: saves.successes, DeathSaveFailures: saves.failures,
		}); err != nil {
			return nil, err
		}
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
	// edits, the other follows, so the two never drift apart mid-fight. An
	// ally's mirrors the same way, into whichever home holds their points —
	// their body's sheet, or their own row (#228).
	if params.HpCurrent != row.HpCurrent || params.HpMax != row.HpMax {
		switch {
		case (row.Kind == "pc" || row.Kind == "ally") && row.CharacterID.Valid:
			if err := s.syncCharacterHP(ctx, uuid.UUID(row.CharacterID.Bytes), params.HpCurrent, params.HpMax); err != nil {
				return nil, err
			}
		case row.Kind == "ally" && row.NpcID.Valid:
			hp := params.HpCurrent
			if _, err := s.queries.SetNpcHp(ctx, db.SetNpcHpParams{
				ID: uuid.UUID(row.NpcID.Bytes), HpCurrent: &hp,
			}); err != nil {
				return nil, err
			}
			s.publish(row.CampaignID, live.TopicNpcs)
		}
	}
	s.publish(row.CampaignID, live.TopicEncounter)
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
	return s.syncSeatedHero(ctx, ch, false)
}

// syncCombatantAC does the same for armour class, and is what keeps a hero who
// straps a shield on mid-fight from reading as the AC they walked in with.
//
// Separate from the HP path because it costs a derivation — the hero's kit and
// their class features — so it is only paid when the kit or the scores it reads
// have actually moved.
func (s *Server) syncCombatantAC(ctx context.Context, ch db.Character) error {
	return s.syncSeatedHero(ctx, ch, true)
}

// syncSeatedHero writes a character's live numbers onto their combatant rows.
// withAC re-derives armour class too; without it the row keeps the AC it has,
// which may be one the DM typed over deliberately.
func (s *Server) syncSeatedHero(ctx context.Context, ch db.Character, withAC bool) error {
	seated, err := s.queries.ListActiveCombatantsForCharacter(ctx, pgUUID(ch.ID))
	if err != nil {
		return err
	}
	if len(seated) == 0 {
		return nil // not in a fight; nothing to keep in step
	}
	ac := int32(0)
	if withAC {
		if ac, err = s.heroArmorClass(ctx, ch); err != nil {
			return err
		}
	}
	for _, c := range seated {
		// A forged body seated as an ally mirrors from the same sheet (#228).
		if c.Kind != "pc" && c.Kind != "ally" {
			continue
		}
		wantAC := c.Ac
		if withAC {
			wantAC = ac
		}
		if c.HpCurrent == ch.HpCurrent && c.HpMax == ch.HpMax && wantAC == c.Ac {
			continue
		}
		if _, err := s.queries.UpdateCombatant(ctx, db.UpdateCombatantParams{
			ID: c.ID, Label: c.Label, PlayerLabel: c.PlayerLabel, Initiative: c.Initiative,
			HpCurrent: ch.HpCurrent, HpMax: ch.HpMax, Ac: wantAC, Hidden: c.Hidden,
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
	s.publish(row.CampaignID, live.TopicEncounter)
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
	s.publish(enc.CampaignID, live.TopicEncounter)
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
	s.publish(row.CampaignID, live.TopicEncounter)
	if isDM {
		return api.RollCombatantInitiative200JSONResponse(combatantForDM(c, false)), nil
	}
	return api.RollCombatantInitiative200JSONResponse(combatantForPlayer(c, true, false)), nil
}
