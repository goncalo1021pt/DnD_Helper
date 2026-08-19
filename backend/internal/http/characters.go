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
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// pgUUID wraps a uuid for the nullable campaign_id column.
func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// seatedCampaign returns the campaign a hero is seated at, if any.
func seatedCampaign(c db.Character) (uuid.UUID, bool) {
	if !c.CampaignID.Valid {
		return uuid.UUID{}, false
	}
	return uuid.UUID(c.CampaignID.Bytes), true
}

// ListCharacters returns the campaign's party roster (members only).
func (s *Server) ListCharacters(ctx context.Context, request api.ListCharactersRequestObject) (api.ListCharactersResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListCharacters401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListCharacters403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	// The roster is the one place every player looks at every hero, so it is
	// where the veil does most of its work: concealed heroes come back as a
	// name and nothing else.
	veil, err := s.loadSheetVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	// Every seated hero's classes in one read (#190) — a roster of six should
	// not cost six extra queries to say "Rogue 5 / Wizard 3".
	classRows, err := s.queries.ListCharacterClassesForCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	classesOf := byCharacter(classesFromCampaign(classRows))

	isDM := member.Role == db.MembershipRoleDm
	out := make([]api.Character, 0, len(rows))
	for _, row := range rows {
		character := toAPICharacterWithClass(db.Character{
			ID: row.ID, CampaignID: row.CampaignID, OwnerUserID: row.OwnerUserID,
			Name: row.Name, Class: row.Class, Level: row.Level,
			HpCurrent: row.HpCurrent, HpMax: row.HpMax, CreatedAt: row.CreatedAt,
			Strength: row.Strength, Dexterity: row.Dexterity, Constitution: row.Constitution,
			Intelligence: row.Intelligence, Wisdom: row.Wisdom, Charisma: row.Charisma,
			Skills: row.Skills, ClassID: row.ClassID, SpeciesID: row.SpeciesID,
			BackgroundID:   row.BackgroundID,
			SubclassID:     row.SubclassID,
			Feats:          row.Feats,
			SpeciesChoices: row.SpeciesChoices,
			SpellSlotsUsed: row.SpellSlotsUsed,
			HitDiceSpent:   row.HitDiceSpent,
			PoolsUsed:      row.PoolsUsed,
			Xp:             row.Xp,
			PendingLevels:  row.PendingLevels,
			TableBorn:      row.TableBorn,
			PartyID:        row.PartyID,
		}, row.OwnerName, member.UserID, row.ClassData, classesOf[row.ID])
		character.PartyName = row.PartyName
		if veil.concealsFrom(row.ID, row.OwnerUserID, member.UserID, isDM) {
			character = conceal(character)
		}
		revealed := veil.revealed[row.ID]
		character.Revealed = &revealed
		out = append(out, character)
	}
	return api.ListCharacters200JSONResponse(out), nil
}

// CreateCharacter quick-adds a table-born character to the roster. DM only:
// a member-wide quick-add would let players seat past the barred door.
func (s *Server) CreateCharacter(ctx context.Context, request api.CreateCharacterRequestObject) (api.CreateCharacterResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	in, errMsg := validateCharacterInput(request.Body)
	if errMsg != "" {
		return api.CreateCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}

	character, err := s.queries.CreateCharacter(ctx, db.CreateCharacterParams{
		CampaignID:  pgUUID(campaignID),
		OwnerUserID: member.UserID,
		Name:        in.name,
		Class:       in.class,
		Level:       in.level,
		HpCurrent:   in.hpCurrent,
		HpMax:       in.hpMax,
	})
	if err != nil {
		return nil, err
	}
	ownerName, err := s.ownerName(ctx, member.UserID)
	if err != nil {
		return nil, err
	}
	return api.CreateCharacter201JSONResponse(toAPICharacter(character, ownerName, member.UserID)), nil
}

// UpdateCharacter edits a character (its owner or the DM).
func (s *Server) UpdateCharacter(ctx context.Context, request api.UpdateCharacterRequestObject) (api.UpdateCharacterResponseObject, error) {
	characterID := uuid.UUID(request.CharacterId)
	character, err := s.queries.GetCharacter(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}

	member, err := s.requireCharacterEditor(ctx, character)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	in, errMsg := validateCharacterInput(request.Body)
	if errMsg != "" {
		return api.UpdateCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	// On an update, an ABSENT class means "unchanged", not "changed to empty" —
	// the absent≠null trap that refused legal HP-only amends of forged heroes
	// (#251). Create keeps reading absent as empty; only an amend has a stored
	// class to keep.
	if request.Body.Class == nil {
		in.class = character.Class
	}

	if refusal := amendRefusal(character, in, member.Role); refusal != "" {
		return api.UpdateCharacter403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{Error: refusal}}, nil
	}

	updated, err := s.queries.UpdateCharacter(ctx, db.UpdateCharacterParams{
		ID:        characterID,
		Name:      in.name,
		Class:     in.class,
		Level:     in.level,
		HpCurrent: in.hpCurrent,
		HpMax:     in.hpMax,
	})
	if err != nil {
		return nil, err
	}
	// Mirror HP forward into whichever running encounter this hero is fighting
	// in — see syncCombatantHP.
	if character.HpCurrent != updated.HpCurrent || character.HpMax != updated.HpMax {
		if err := s.syncCombatantHP(ctx, updated); err != nil {
			return nil, err
		}
	}
	ownerName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	return api.UpdateCharacter200JSONResponse(toAPICharacterWithClass(updated, ownerName, member.UserID, s.classDataFor(ctx, updated), s.classesFor(ctx, updated))), nil
}

// DeleteCharacter removes a character (its owner or the DM).
func (s *Server) DeleteCharacter(ctx context.Context, request api.DeleteCharacterRequestObject) (api.DeleteCharacterResponseObject, error) {
	characterID := uuid.UUID(request.CharacterId)
	character, err := s.queries.GetCharacter(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}

	// Destroying a hero is the owner's act alone. The one exception is a
	// table-born character, which the seated table's DM may also strike.
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.DeleteCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if uid != character.OwnerUserID {
		allowed := false
		if campaignID, seated := seatedCampaign(character); seated && character.TableBorn {
			if _, err := s.requireDM(ctx, campaignID); err == nil {
				allowed = true
			} else if !errors.Is(err, errForbidden) && !errors.Is(err, errNoAuth) {
				return nil, err
			}
		}
		if !allowed {
			return api.DeleteCharacter403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{
				Error: "only the hero's owner may destroy them — the table can only unseat",
			}}, nil
		}
	}

	if err := s.queries.DeleteCharacter(ctx, characterID); err != nil {
		return nil, err
	}
	return api.DeleteCharacter204Response{}, nil
}

// requireCharacterEditor allows the character's owner or, when the hero is
// seated at a campaign, that campaign's DM. Unseated heroes are owner-only.
func (s *Server) requireCharacterEditor(ctx context.Context, character db.Character) (db.Membership, error) {
	campaignID, seated := seatedCampaign(character)
	if !seated {
		uid, ok := auth.UserID(ctx)
		if !ok {
			return db.Membership{}, errNoAuth
		}
		if uid != character.OwnerUserID {
			return db.Membership{}, errForbidden
		}
		return db.Membership{UserID: uid}, nil
	}
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		return member, err
	}
	if member.UserID != character.OwnerUserID && member.Role != db.MembershipRoleDm {
		return member, errForbidden
	}
	return member, nil
}

/*
Who may rewrite a hero, and which parts.

Three kinds of hero share this one endpoint, and for a while they shared its
permissions too — the roster's Amend form was written for quick-added heroes
and never re-gated when the Forge arrived, so a player could re-class a
wizard-built hero from the party screen.

  - Forged (a class_id, set only by the Forge wizard): name, class and level
    are the wizard's and the level-up's. Nobody rewrites them here — not the
    player, not the DM.
  - Table-born (quick-added onto a roster): the DM's own scribble, so the DM
    may amend it and the player who plays it may not.
  - Account quick-adds (My Heroes' freeform form): the owner's scratch entry,
    with no sheet to contradict. Unchanged — theirs to amend.

HP is nobody's identity and stays live for all three, which is what the ±
buttons on the roster actually send.
*/

// forged reports whether a hero came out of the Forge wizard. It is the only
// path that records a class_id.
func forged(c db.Character) bool { return c.ClassID.Valid }

// identityChanged reports whether an update rewrites who a hero is, as opposed
// to how they are faring.
func identityChanged(c db.Character, in characterInput) bool {
	return in.name != c.Name || in.class != c.Class || in.level != c.Level
}

// amendRefusal returns the reason an update must be refused, or "" to allow it.
// role is the caller's membership role at the hero's table, empty when the hero
// sits at no table.
func amendRefusal(c db.Character, in characterInput, role db.MembershipRole) string {
	if !identityChanged(c, in) {
		return ""
	}
	switch {
	case forged(c):
		return "a forged hero's name, class and level are set in the Forge and at level-up — the roster only tracks their HP"
	case c.TableBorn && role != db.MembershipRoleDm:
		return "only the DM may amend a hero born of the table"
	}
	return ""
}

type characterInput struct {
	name      string
	class     string
	level     int32
	hpCurrent int32
	hpMax     int32
}

// validateCharacterInput normalizes and bounds-checks the shared create/update
// body. HP current is clamped into [0, hpMax] rather than rejected.
func validateCharacterInput(body *api.CharacterInput) (characterInput, string) {
	if body == nil {
		return characterInput{}, "a character body is required"
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > 80 {
		return characterInput{}, "name must be between 1 and 80 characters"
	}
	class := ""
	if body.Class != nil {
		class = strings.TrimSpace(*body.Class)
	}
	if len([]rune(class)) > 80 {
		return characterInput{}, "class must be at most 80 characters"
	}
	if body.Level < 1 || body.Level > 20 {
		return characterInput{}, "level must be between 1 and 20"
	}
	if body.HpMax < 1 || body.HpMax > 9999 {
		return characterInput{}, "max HP must be between 1 and 9999"
	}
	hpCurrent := min(max(body.HpCurrent, 0), body.HpMax)
	return characterInput{
		name:      name,
		class:     class,
		level:     int32(body.Level),
		hpCurrent: int32(hpCurrent),
		hpMax:     int32(body.HpMax),
	}, ""
}

func (s *Server) ownerName(ctx context.Context, ownerID uuid.UUID) (string, error) {
	owner, err := s.queries.GetUserByID(ctx, ownerID)
	if err != nil {
		return "", err
	}
	return owner.Name, nil
}

// toAPICharacterWithClass enriches a caster's sheet with slot state derived
// from the class data (nil classData = no enrichment).
// toAPICharacterWithClass renders a hero with everything their class implies.
//
// `classes` is an argument rather than something looked up in here because the
// roster reads all of them in one query and a single-hero endpoint reads one —
// and because making it explicit means a new call site cannot quietly serve a
// multiclassed hero as though they had one class. Pass nil only for a hero who
// genuinely has none (quick-add), or where the caller has already established
// there are none to show.
func toAPICharacterWithClass(c db.Character, ownerName string, viewer uuid.UUID, classData []byte, classes []heroClass) api.Character {
	out := toAPICharacter(c, ownerName, viewer)
	if out.Sheet != nil && (classData != nil || len(classes) > 0) {
		ability, slots, pact := spellSlotsFor(classData, classes, c.Level, c.SpellSlotsUsed, c.PactSlotsUsed)
		out.Sheet.SpellcastingAbility = ability
		out.Sheet.SpellSlots = slots
		out.Sheet.PactSlots = pact
	}
	if out.Sheet != nil && len(classes) > 0 {
		list := toAPICharacterClasses(classes, c.ClassID)
		out.Sheet.Classes = &list
	}
	// Hit dice pooled across every class the hero holds, which is the only
	// version that is right for a multiclassed one (#190).
	if len(classes) > 0 {
		dice := toAPIHitDice(hitDicePoolsOf(classes, int(c.Level), c.HitDiceSpent))
		out.HitDice = &dice
	}
	return out
}

func toAPICharacter(c db.Character, ownerName string, viewer uuid.UUID) api.Character {
	var campaignID *uuid.UUID
	if id, ok := seatedCampaign(c); ok {
		campaignID = &id
	}
	var partyID *uuid.UUID
	if c.PartyID.Valid {
		id := uuid.UUID(c.PartyID.Bytes)
		partyID = &id
	}
	var sheet *api.CharacterSheet
	if c.Strength != nil && c.Dexterity != nil && c.Constitution != nil &&
		c.Intelligence != nil && c.Wisdom != nil && c.Charisma != nil {
		uuidPtr := func(u pgtype.UUID) *uuid.UUID {
			if !u.Valid {
				return nil
			}
			id := uuid.UUID(u.Bytes)
			return &id
		}
		skills := c.Skills
		if skills == nil {
			skills = []string{}
		}
		feats := c.Feats
		if feats == nil {
			feats = []string{}
		}
		// Species picks are stored as raw JSON; a hero forged before the
		// column existed simply has none.
		var speciesChoices *api.SpeciesChoices
		if len(c.SpeciesChoices) > 0 {
			var picks api.SpeciesChoices
			if err := json.Unmarshal(c.SpeciesChoices, &picks); err == nil && len(picks) > 0 {
				speciesChoices = &picks
			}
		}
		sheet = &api.CharacterSheet{
			Abilities: api.AbilityScores{
				Str: int(*c.Strength), Dex: int(*c.Dexterity), Con: int(*c.Constitution),
				Int: int(*c.Intelligence), Wis: int(*c.Wisdom), Cha: int(*c.Charisma),
			},
			Skills:         skills,
			Feats:          &feats,
			ClassId:        uuidPtr(c.ClassID),
			SpeciesId:      uuidPtr(c.SpeciesID),
			BackgroundId:   uuidPtr(c.BackgroundID),
			SubclassId:     uuidPtr(c.SubclassID),
			SpeciesChoices: speciesChoices,
		}
	}
	xp := int(c.Xp)
	pending := int(c.PendingLevels)
	// Dice by level alone — right for a quick-add hero, who has no class to
	// ask. toAPICharacterWithClass replaces this with the real pools once the
	// hero's classes are in hand (#190).
	hitDice := toAPIHitDice(rules.HitDicePools(nil, int(c.Level), decodeHitDiceSpent(c.HitDiceSpent)))
	return api.Character{
		Sheet:         sheet,
		Xp:            &xp,
		PendingLevels: &pending,
		HitDice:       &hitDice,
		Id:            c.ID,
		CampaignId:    campaignID,
		OwnerUserId:   c.OwnerUserID,
		OwnerName:     ownerName,
		Name:          c.Name,
		Class:         c.Class,
		Level:         int(c.Level),
		HpCurrent:     int(c.HpCurrent),
		HpMax:         int(c.HpMax),
		CreatedAt:     c.CreatedAt.Time,
		Mine:          c.OwnerUserID == viewer,
		TableBorn:     c.TableBorn,
		PartyId:       partyID,
	}
}
