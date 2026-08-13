package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// The class-data slice level-up needs. Defaults follow the 2024 rules:
// subclass at 3, ASIs at 4/8/12/16/19.
type levelUpClassRules struct {
	HitDie         int                   `json:"hitDie"`
	SubclassLevel  int                   `json:"subclassLevel"`
	AsiLevels      []int                 `json:"asiLevels"`
	PrimaryAbility []string              `json:"primaryAbility"`
	Multiclass     *rules.MulticlassData `json:"multiclass"`
}

/*
takingLevelIn works out which class this level goes into, and whether the hero
is allowed to put it there (#190).

Three cases. Say nothing and a single-classed hero advances the class they
have — the old behaviour, and what every existing client sends. Say nothing
with two classes and it is a question only the player can answer, so it is
refused rather than guessed. Name a class they do not hold and they are
multiclassing, which the 2024 prerequisite gates: 13+ in the primary ability
of the new class AND of every class they already hold (PHB 2024, p.44).
*/
func (s *Server) takingLevelIn(
	ctx context.Context,
	character db.Character,
	held []heroClass,
	asked *uuid.UUID,
	scores map[string]int,
) (classID uuid.UUID, fresh bool, errMsg string) {
	if asked == nil {
		switch len(held) {
		case 1:
			return held[0].ClassID, false, ""
		case 0:
			// Backfilled rows cover every forged hero, so this is a hero whose
			// class rows never arrived — fall back to the column.
			if character.ClassID.Valid {
				return uuid.UUID(character.ClassID.Bytes), false, ""
			}
			return uuid.Nil, false, "this hero has no class to advance"
		default:
			return uuid.Nil, false, "say which class takes this level"
		}
	}

	want := uuid.UUID(*asked)
	for _, k := range held {
		if k.ClassID == want {
			return want, false, "" // another level in a class they already have
		}
	}

	// A class they do not hold: the door, and its price.
	entry, err := s.fetchContent(ctx, want, db.ContentKindClass)
	if err != nil {
		return uuid.Nil, false, "that class is not in this world's library"
	}
	var cr levelUpClassRules
	if err := json.Unmarshal(entry.Data, &cr); err != nil {
		return uuid.Nil, false, fmt.Sprintf("malformed class data for %s", entry.Name)
	}
	if ok, missing := rules.MeetsPrereq(cr.PrimaryAbility, cr.Multiclass, scores); !ok {
		return uuid.Nil, false, fmt.Sprintf("%s asks for %s before it will take you", entry.Name, missing)
	}
	// And what they already are has to hold up its end.
	for _, k := range held {
		var have levelUpClassRules
		if json.Unmarshal(k.ClassData, &have) != nil {
			continue
		}
		if ok, missing := rules.MeetsPrereq(have.PrimaryAbility, have.Multiclass, scores); !ok {
			return uuid.Nil, false, fmt.Sprintf(
				"multiclassing asks %s of your %s levels too", missing, k.ClassName)
		}
	}
	return want, true, ""
}

type subclassRules struct {
	Class string `json:"class"`
}

// What stops a seated hero rising. The client repeats this decision in
// lib/progression.ts so the Level up button can explain itself rather than
// offering a press that fails, so the two are held together by
// fixtures/rules/level-up-gates.json.
//
// The reason is a code rather than a sentence because the two sides word it
// differently on purpose: the server raises an error a player reads once, the
// client writes a line that sits under a disabled button.
const (
	holdCeiling   = "ceiling"
	holdMilestone = "milestone"
)

// levelUpHold names what is holding a hero at their current level, or "" when
// the road is clear.
//
// The ceiling is asked first, and that ordering is the part worth pinning: a
// hero standing at the table's cap with a milestone already banked is held by
// the cap. Answer "milestone" there and the player is told to wait on a DM who
// has done their part — they would go and ask, and the DM would have nothing
// to give them.
func levelUpHold(level, pendingLevels int, progression db.ProgressionMode, maxLevel *int16) string {
	if maxLevel != nil && level >= int(*maxLevel) {
		return holdCeiling
	}
	// XP tables gate on XP alone, which the client already shows; the pending
	// allowance is the DM's lever on milestone tables only.
	if progression == db.ProgressionModeMilestone && pendingLevels < 1 {
		return holdMilestone
	}
	return ""
}

// LevelUpCharacter advances a forged hero one level: HP by average or roll,
// subclass at the class's subclass level, ASI or feat at ASI levels. CON
// increases raise max HP retroactively, as the 2024 rules do.
func (s *Server) LevelUpCharacter(ctx context.Context, request api.LevelUpCharacterRequestObject) (api.LevelUpCharacterResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.LevelUpCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	badRequest := func(msg string) (api.LevelUpCharacterResponseObject, error) {
		return api.LevelUpCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}

	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.LevelUpCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if character.OwnerUserID != uid {
		return api.LevelUpCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if request.Body == nil {
		return badRequest("a level-up body is required")
	}
	body := request.Body

	if !character.ClassID.Valid || character.Constitution == nil {
		return badRequest("only forged heroes level up here — quick-add heroes edit their level directly")
	}
	if character.Level >= 20 {
		return badRequest("already at the summit — level 20 is the end of the road")
	}
	newLevel := int(character.Level) + 1

	abilities := map[string]int{
		"str": int(*character.Strength), "dex": int(*character.Dexterity),
		"con": int(*character.Constitution), "int": int(*character.Intelligence),
		"wis": int(*character.Wisdom), "cha": int(*character.Charisma),
	}
	conModBefore := abilityMod(abilities["con"])

	// Which class takes this level, and may it (#190).
	held := s.classesFor(ctx, character)
	classID, freshClass, errMsg := s.takingLevelIn(ctx, character, held, body.ClassId, abilities)
	if errMsg != "" {
		return badRequest(errMsg)
	}

	class, err := s.fetchContent(ctx, classID, db.ContentKindClass)
	if err != nil {
		return nil, fmt.Errorf("hero's class vanished: %w", err)
	}
	var cr levelUpClassRules
	if err := json.Unmarshal(class.Data, &cr); err != nil || cr.HitDie < 4 {
		return nil, fmt.Errorf("malformed class data for %s", class.Name)
	}
	if cr.SubclassLevel == 0 {
		cr.SubclassLevel = 3
	}
	if len(cr.AsiLevels) == 0 {
		cr.AsiLevels = []int{4, 8, 12, 16, 19}
	}

	/*
		The level within THIS class, which is what the class's own tables are
		indexed by — its subclass level, its ASIs, its features. A Rogue 5
		taking a first Wizard level gets Wizard 1, not Wizard 6: "when you gain
		a new level in a class, you get its features for that level"
		(PHB 2024, p.44).

		Total character level still governs proficiency bonus, XP and cantrip
		scaling, and stays `newLevel`.
	*/
	classLevel := 1
	for _, k := range held {
		if k.ClassID == classID {
			classLevel = int(k.Level) + 1
		}
	}

	// --- Ability increases / feat (ASI levels only) ---
	asiLevel := false
	for _, lv := range cr.AsiLevels {
		if lv == classLevel {
			asiLevel = true
		}
	}
	increases := map[string]int{}
	if body.Asi != nil {
		read := func(key string, v *int) {
			if v != nil {
				increases[key] = *v
			}
		}
		read("str", body.Asi.Str)
		read("dex", body.Asi.Dex)
		read("con", body.Asi.Con)
		read("int", body.Asi.Int)
		read("wis", body.Asi.Wis)
		read("cha", body.Asi.Cha)
	}
	hasASI := len(increases) > 0
	hasFeat := body.FeatId != nil

	if !asiLevel && (hasASI || hasFeat) {
		return badRequest(fmt.Sprintf("%s gains no ability increase at %s level %d", class.Name, class.Name, classLevel))
	}
	if asiLevel && hasASI == hasFeat {
		return badRequest("an ASI level takes either ability increases or a feat — exactly one")
	}
	if hasASI {
		total := 0
		for ab, inc := range increases {
			if inc < 1 || inc > 2 {
				return badRequest("each ability increase must be +1 or +2")
			}
			total += inc
			if abilities[ab]+inc > 20 {
				return badRequest(strings.ToUpper(ab) + " cannot rise above 20")
			}
		}
		if total != 2 {
			return badRequest("ability increases must total exactly 2 points (+2 to one or +1 to two)")
		}
		for ab, inc := range increases {
			abilities[ab] += inc
		}
	}

	feats := character.Feats
	if feats == nil {
		feats = []string{}
	}
	if hasFeat {
		feat, err := s.fetchVisibleContent(ctx, uuid.UUID(*body.FeatId), db.ContentKindFeat, uid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return badRequest("unknown feat")
			}
			return badRequest("that choice is not a feat")
		}
		for _, f := range feats {
			if f == feat.Name {
				return badRequest(character.Name + " already has " + feat.Name)
			}
		}
		feats = append(feats, feat.Name)
	}

	// --- Subclass (exactly at the class's subclass level, counted in that
	// class's own levels — each class a hero holds picks its own) ---
	// Its data travels to the spell checks below, because the casting may be
	// declared there — an Eldritch Knight chosen at Fighter 3 picks Wizard
	// cantrips in the same breath (#220).
	subclassID := pgtype.UUID{}
	var subclassData []byte
	for _, k := range held {
		if k.ClassID == classID {
			subclassID = k.SubclassID
			subclassData = k.SubclassData
		}
	}
	if classLevel == cr.SubclassLevel {
		if body.SubclassId == nil {
			return badRequest(fmt.Sprintf("%s chooses a subclass at %s level %d", class.Name, class.Name, classLevel))
		}
		sub, err := s.fetchVisibleContent(ctx, uuid.UUID(*body.SubclassId), db.ContentKindSubclass, uid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return badRequest("unknown subclass")
			}
			return badRequest("that choice is not a subclass")
		}
		var sr subclassRules
		if err := json.Unmarshal(sub.Data, &sr); err != nil || !strings.EqualFold(sr.Class, class.Name) {
			return badRequest(sub.Name + " does not belong to " + class.Name)
		}
		subclassID = pgUUID(sub.ID)
		subclassData = sub.Data
	} else if body.SubclassId != nil {
		return badRequest(fmt.Sprintf("%s chooses a subclass at %s level %d, not %d",
			class.Name, class.Name, cr.SubclassLevel, classLevel))
	}

	// --- New spells (casters only, additions validated against the new level) ---
	var newSpells []uuid.UUID
	if body.Spells != nil {
		for _, id := range *body.Spells {
			newSpells = append(newSpells, uuid.UUID(id))
		}
	}
	existingSpells, err := s.queries.ListCharacterSpells(ctx, character.ID)
	if err != nil {
		return nil, err
	}

	// Bard, Sorcerer and Warlock trade a spell on the way up rather than on a
	// Long Rest. The swap is settled first so the new picks are counted against
	// the list the hero will actually have.
	var swaps swapResult
	if body.SpellSwaps != nil && len(*body.SpellSwaps) > 0 {
		msg, resolved, err := s.validateSpellSwaps(
			ctx, uid, class, subclassData, newLevel, existingSpells, *body.SpellSwaps, "level-up")
		if err != nil {
			return nil, err
		}
		if msg != "" {
			return badRequest(msg)
		}
		swaps = resolved
	}
	afterSwaps := existingSpells
	if len(swaps.Out) > 0 {
		dropped := map[uuid.UUID]bool{}
		for _, id := range swaps.Out {
			dropped[id] = true
		}
		afterSwaps = afterSwaps[:0:0]
		for _, row := range existingSpells {
			if !dropped[row.ID] {
				afterSwaps = append(afterSwaps, row)
			}
		}
	}
	if msg, _, err := s.validateSpellPicks(ctx, uid, class, subclassData, newLevel, afterSwaps, newSpells); err != nil {
		return nil, err
	} else if msg != "" {
		return badRequest(msg)
	}
	// A spell can't be both taken as a new pick and taken as a swap-in.
	for _, id := range swaps.In {
		for _, n := range newSpells {
			if id == n {
				return badRequest("the same spell was both learned and swapped in")
			}
		}
	}

	// Milestone tables gate level-ups on a pending allowance (XP is advisory),
	// and no seated hero rises past the DM's ceiling.
	if campaignID, seated := seatedCampaign(character); seated {
		campaign, err := s.queries.GetCampaign(ctx, campaignID)
		if err != nil {
			return nil, err
		}
		switch levelUpHold(int(character.Level), int(character.PendingLevels), campaign.Progression, campaign.MaxLevel) {
		case holdCeiling:
			return badRequest(fmt.Sprintf("the table's ceiling is level %d — the DM must raise it first", *campaign.MaxLevel))
		case holdMilestone:
			return badRequest("no milestone reached yet — the DM decides when the party rises")
		}
	}

	// A seated hero's new choices must also be legal in that campaign's world.
	if campaignID, seated := seatedCampaign(character); seated {
		var chosen []uuid.UUID
		if hasFeat {
			chosen = append(chosen, uuid.UUID(*body.FeatId))
		}
		if newLevel == cr.SubclassLevel && body.SubclassId != nil {
			chosen = append(chosen, uuid.UUID(*body.SubclassId))
		}
		chosen = append(chosen, newSpells...)
		blockers, err := s.codexBlockers(ctx, campaignID, chosen)
		if err != nil {
			return nil, err
		}
		if len(blockers) > 0 {
			return badRequest(blockers[0].row.Name + " is not admitted by the campaign's codex — ask the DM")
		}
	}

	// --- Hit points ---
	var die int
	switch body.HpMode {
	case api.Average:
		die = cr.HitDie/2 + 1
	case api.Roll:
		if body.HpRoll == nil {
			return badRequest("hpMode roll needs the hpRoll die result")
		}
		die = *body.HpRoll
		if die < 1 || die > cr.HitDie {
			return badRequest(fmt.Sprintf("hpRoll must be between 1 and %d for a d%d class", cr.HitDie, cr.HitDie))
		}
	default:
		return badRequest("hpMode must be average or roll")
	}
	conModAfter := abilityMod(abilities["con"])
	gain := die + conModAfter
	if gain < 1 {
		gain = 1
	}
	// A CON modifier increase applies to every level already lived.
	retro := (conModAfter - conModBefore) * int(character.Level)
	delta := int32(gain + retro)

	// characters.subclass_id belongs to the STARTING class (#190). A Wizard
	// tradition picked by a Rogue 5 / Wizard 3 lives on the Wizard's row and
	// must not overwrite the Thief on the character.
	characterSubclass := character.SubclassID
	if character.ClassID.Valid && uuid.UUID(character.ClassID.Bytes) == classID {
		characterSubclass = subclassID
	}

	s16 := func(v int) *int16 { x := int16(v); return &x }
	updated, err := s.queries.LevelUpCharacter(ctx, db.LevelUpCharacterParams{
		ID:           character.ID,
		Level:        int32(newLevel),
		HpMax:        character.HpMax + delta,
		HpCurrent:    character.HpCurrent + delta,
		Strength:     s16(abilities["str"]),
		Dexterity:    s16(abilities["dex"]),
		Constitution: s16(abilities["con"]),
		Intelligence: s16(abilities["int"]),
		Wisdom:       s16(abilities["wis"]),
		Charisma:     s16(abilities["cha"]),
		SubclassID:   characterSubclass,
		Feats:        feats,
	})
	if err != nil {
		return nil, err
	}
	// The level goes into the class that took it (#190). A class taken for the
	// first time joins the list at the end; the order is how they were taken.
	position := int16(0)
	if freshClass {
		if next, err := s.queries.NextCharacterClassPosition(ctx, updated.ID); err == nil {
			position = next
		}
	}
	if err := s.queries.UpsertCharacterClass(ctx, db.UpsertCharacterClassParams{
		CharacterID: updated.ID,
		ClassID:     class.ID,
		SubclassID:  subclassID,
		Level:       int16(classLevel),
		Position:    position,
	}); err != nil {
		return nil, err
	}
	// The upsert deliberately does not touch subclass_id — a level-up that
	// makes no subclass choice must not erase the one already there — so a
	// choice made now is written on its own.
	if subclassID.Valid {
		if err := s.queries.SetCharacterClassSubclass(ctx, db.SetCharacterClassSubclassParams{
			CharacterID: updated.ID,
			ClassID:     class.ID,
			SubclassID:  subclassID,
		}); err != nil {
			return nil, err
		}
	}
	if err := s.applySpellSwaps(ctx, updated.ID, pgUUID(class.ID), swaps); err != nil {
		return nil, err
	}
	if len(newSpells) > 0 {
		if err := s.queries.AddCharacterSpells(ctx, db.AddCharacterSpellsParams{
			CharacterID: updated.ID,
			Column2:     newSpells,
			// Spells gained with this level belong to the class that took it.
			ClassID:     pgUUID(class.ID),
		}); err != nil {
			return nil, err
		}
	}
	if campaignID, seated := seatedCampaign(character); seated {
		if err := s.queries.SpendPendingLevel(ctx, character.ID); err != nil {
			return nil, err
		}
		s.logEvent(ctx, campaignID, uid, "level_up",
			fmt.Sprintf("%s rises to level %d", character.Name, newLevel))
		if fresh, err := s.queries.GetCharacter(ctx, updated.ID); err == nil {
			updated = fresh
		}
	}
	ownerName, err := s.ownerName(ctx, character.OwnerUserID)
	if err != nil {
		return nil, err
	}
	return api.LevelUpCharacter200JSONResponse(toAPICharacterWithClass(updated, ownerName, uid, class.Data, s.classesFor(ctx, updated))), nil
}
