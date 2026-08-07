package http

/*
The second stat block.

A Druid turns into a wolf; a Battle Smith walks in with a Steel Defender; a
Wizard's familiar takes its own turn. All three are "a creature attached to a
hero", and all three were invisible here: the sheet showed one stat block, and
the Den — where every stat block in the instance lives — is a DM room a player
cannot open.

This is the whole of the player's reach into monster content, and it is
deliberately narrow: `creatureOptions` asks the hero's own features what they
grant and answers with nothing else. A Druid gets the Beasts under their CR
ceiling because Wild Shape says so; they do not get the Den, and a hero whose
features grant nothing gets an empty answer.

Which features grant what is content, not code (see rules/creatures.go). That
is what makes an Artificer possible without shipping one: a pack carries a
`monster` named Steel Defender and a `subclass` that names it back, and the
sheet grows a companion for a class this repo has never heard of.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// heroScope is the hero as a formula sees them: a level and six modifiers.
func heroScope(c db.Character) rules.Scope {
	scores := map[string]int{}
	for name, ptr := range map[string]*int16{
		"str": c.Strength, "dex": c.Dexterity, "con": c.Constitution,
		"int": c.Intelligence, "wis": c.Wisdom, "cha": c.Charisma,
	} {
		if ptr != nil {
			scores[name] = int(*ptr)
		}
	}
	return rules.ScopeFor(int(c.Level), scores)
}

// grantSource is one content entry that might declare a creature, kept with
// the name to stamp on whatever it grants.
type grantSource struct {
	name string
	data []byte
}

// grantSources gathers everything a hero carries that could grant a creature:
// the four sheet references, their feats, and their gear. Anything unreadable
// or dangling is skipped — a missing subclass should cost you a companion, not
// the page.
func (s *Server) grantSources(ctx context.Context, c db.Character) []grantSource {
	var out []grantSource
	add := func(row db.RulesContent) {
		if len(row.Data) > 0 {
			out = append(out, grantSource{name: row.Name, data: row.Data})
		}
	}

	for _, ref := range []pgtype.UUID{c.ClassID, c.SubclassID, c.SpeciesID, c.BackgroundID} {
		if !ref.Valid {
			continue
		}
		if row, err := s.queries.GetContent(ctx, uuid.UUID(ref.Bytes)); err == nil {
			add(row)
		}
	}

	// Feats are recorded as names, and a background records them with their
	// specialisation — "Magic Initiate (Cleric)" — so the bare name has to
	// match too, the same fallback the sheet makes when it prints them.
	if len(c.Feats) > 0 {
		feats, err := s.queries.ListContentByKind(ctx, db.ListContentByKindParams{
			Kind:      db.ContentKindFeat,
			CreatedBy: pgUUID(c.OwnerUserID),
		})
		if err == nil {
			byName := map[string]db.ListContentByKindRow{}
			for _, f := range feats {
				byName[strings.ToLower(f.Name)] = f
			}
			for _, taken := range c.Feats {
				key := strings.ToLower(strings.TrimSpace(taken))
				row, ok := byName[key]
				if !ok {
					bare := strings.TrimSpace(strings.Split(key, "(")[0])
					row, ok = byName[bare]
				}
				if ok {
					add(db.RulesContent{Name: row.Name, Data: row.Data})
				}
			}
		}
	}

	// Gear counts: a figurine that becomes a beast is an item that grants a
	// companion, and content says so the same way a subclass does.
	if items, err := s.queries.ListCharacterItems(ctx, c.ID); err == nil {
		for _, it := range items {
			if it.ContentID.Valid && len(it.Data) > 0 {
				out = append(out, grantSource{name: it.Name, data: it.Data})
			}
		}
	}
	return out
}

// visibleMonsters is the pool a hero's creatures may be drawn from: SRD plus
// the hero owner's own homebrew. Narrowing to what their features grant is the
// caller's job.
func (s *Server) visibleMonsters(ctx context.Context, owner uuid.UUID) ([]db.RulesContent, error) {
	return s.queries.ListMonstersForCreatures(ctx, pgUUID(owner))
}

// creatureOptions answers "what may this hero have?" — the forms their
// shapeshifting features admit, and the companions their features name.
func (s *Server) creatureOptions(ctx context.Context, c db.Character) (api.CreatureOptions, error) {
	out := api.CreatureOptions{Forms: []api.FormAllowance{}, Companions: []api.CreatureOption{}}
	scope := heroScope(c)
	sources := s.grantSources(ctx, c)
	if len(sources) == 0 {
		return out, nil
	}

	// Only pay for the monster list if something actually grants a creature.
	var wantsMonsters bool
	for _, src := range sources {
		companions, forms := rules.GrantsIn(src.data)
		if len(companions) > 0 || forms != nil {
			wantsMonsters = true
			break
		}
	}
	if !wantsMonsters {
		return out, nil
	}
	monsters, err := s.visibleMonsters(ctx, c.OwnerUserID)
	if err != nil {
		return out, err
	}
	byName := map[string]db.RulesContent{}
	for _, m := range monsters {
		// SRD first, so a homebrew entry shadowing an SRD name does not
		// silently replace the block a feature meant to point at.
		if prior, seen := byName[strings.ToLower(m.Name)]; seen && prior.Source == db.ContentSourceSrd {
			continue
		}
		byName[strings.ToLower(m.Name)] = m
	}

	option := func(row db.RulesContent, role api.CreatureRole, grantedBy, summary string) api.CreatureOption {
		block, _, _ := rules.ResolveBlock(row.Data, nil, scope)
		id := row.ID
		if summary == "" {
			summary = row.Summary
		}
		return api.CreatureOption{
			ContentId: &id,
			Name:      row.Name,
			Summary:   &summary,
			Role:      role,
			GrantedBy: &grantedBy,
			Block:     block,
		}
	}

	for _, src := range sources {
		companions, forms := rules.GrantsIn(src.data)

		for _, grant := range companions {
			if grant.Level > int(c.Level) {
				continue
			}
			row, ok := byName[strings.ToLower(grant.Name)]
			if !ok {
				continue // names a block this instance does not have
			}
			role := api.CreatureRole(grant.Role)
			if !role.Valid() {
				role = api.Companion
			}
			out.Companions = append(out.Companions, option(row, role, src.name, grant.Summary))
		}

		allowance, ok := forms.At(int(c.Level), scope)
		if !ok {
			continue
		}
		feature := allowance.Feature
		if feature == "" {
			feature = src.name
		}
		choices := []api.CreatureOption{}
		for _, m := range monsters {
			if allowance.EligibleForm(m.Data) {
				choices = append(choices, option(m, api.Form, feature, ""))
			}
		}
		creatureType := allowance.Type
		out.Forms = append(out.Forms, api.FormAllowance{
			Feature:      feature,
			CreatureType: &creatureType,
			Known:        allowance.Known,
			MaxCR:        float32(allowance.MaxCR),
			Fly:          allowance.Fly,
			TempHp:       allowance.TempHP,
			Options:      choices,
		})
	}
	return out, nil
}

// formTempHP is what assuming a form grants this hero, across every
// shapeshifting feature they have. Zero when nothing declares any.
func (s *Server) formTempHP(ctx context.Context, c db.Character) int {
	scope := heroScope(c)
	best := 0
	for _, src := range s.grantSources(ctx, c) {
		_, forms := rules.GrantsIn(src.data)
		if allowance, ok := forms.At(int(c.Level), scope); ok && allowance.TempHP > best {
			best = allowance.TempHP
		}
	}
	return best
}

// listCreatures builds the sheet's view of a hero's creatures, each block
// already resolved so the client renders numbers rather than formulas.
func (s *Server) listCreatures(ctx context.Context, c db.Character) ([]api.CharacterCreature, error) {
	rows, err := s.queries.ListCharacterCreatures(ctx, c.ID)
	if err != nil {
		return nil, err
	}
	out := make([]api.CharacterCreature, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	scope := heroScope(c)

	// Only worth resolving when a form is actually on the sheet.
	tempHP := 0
	for _, row := range rows {
		if row.Role == db.CreatureRoleForm {
			tempHP = s.formTempHP(ctx, c)
			break
		}
	}

	for _, row := range rows {
		out = append(out, toAPICreature(row, scope, tempHP))
	}
	return out, nil
}

func toAPICreature(row db.ListCharacterCreaturesRow, scope rules.Scope, tempHP int) api.CharacterCreature {
	overrides := map[string]any{}
	if len(row.Overrides) > 0 {
		_ = json.Unmarshal(row.Overrides, &overrides)
	}
	block, molded, _ := rules.ResolveBlock(row.ContentData, overrides, scope)

	source := api.CharacterCreatureBlockSourceCustom
	if row.ContentSource != nil {
		source = api.CharacterCreatureBlockSource(string(*row.ContentSource))
	}
	grantedBy := row.GrantedBy
	notes := row.Notes
	out := api.CharacterCreature{
		Id:          row.ID,
		Role:        api.CreatureRole(string(row.Role)),
		Name:        row.Name,
		GrantedBy:   &grantedBy,
		Active:      row.Active,
		Notes:       &notes,
		BlockSource: &source,
		Block:       block,
		Molded:      molded,
		Overrides:   &overrides,
	}
	if row.ContentID.Valid {
		id := uuid.UUID(row.ContentID.Bytes)
		out.ContentId = &id
	}
	// The pool is read off the block every time rather than stored, so a
	// companion whose hit points are "five times your level" grows with the
	// hero. Stored damage is clamped to it; an undamaged creature has no row
	// of its own and reads as full.
	if row.Role != db.CreatureRoleForm {
		if max, ok := rules.BlockHP(block); ok && max > 0 {
			current := max
			if row.HpCurrent != nil && int(*row.HpCurrent) < max {
				current = int(*row.HpCurrent)
			}
			out.HpMax, out.HpCurrent = &max, &current
		}
	} else if tempHP > 0 {
		// In a form the hero keeps their own hit points and gains temporary
		// ones, so the number worth showing on one is the grant, not a pool.
		out.TempHp = &tempHP
	}
	return out
}

// loadCreature is the shared prologue: the hero must be editable by the
// caller, and the creature must belong to that hero.
func (s *Server) loadCreature(ctx context.Context, characterID, creatureID uuid.UUID) (db.Character, db.CharacterCreature, error) {
	character, err := s.loadEditableCharacter(ctx, characterID)
	if err != nil {
		return db.Character{}, db.CharacterCreature{}, err
	}
	row, err := s.queries.GetCharacterCreature(ctx, creatureID)
	if err != nil || row.CharacterID != character.ID {
		return character, db.CharacterCreature{}, pgx.ErrNoRows
	}
	return character, row, nil
}

// AddCharacterCreature attaches a form, companion or summon to a hero.
func (s *Server) AddCharacterCreature(ctx context.Context, request api.AddCharacterCreatureRequestObject) (api.AddCharacterCreatureResponseObject, error) {
	characterID := uuid.UUID(request.CharacterId)
	character, err := s.queries.GetCharacter(ctx, characterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.AddCharacterCreature404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	member, err := s.requireCharacterEditor(ctx, character)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.AddCharacterCreature401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.AddCharacterCreature403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.AddCharacterCreatureResponseObject, error) {
		return api.AddCharacterCreature400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a creature body is required")
	}
	body := request.Body
	if !body.Role.Valid() {
		return badRequest("role must be form, companion or summon")
	}
	isDM := member.Role == db.MembershipRoleDm && member.UserID != character.OwnerUserID

	name := ""
	var contentID pgtype.UUID
	if body.ContentId != nil {
		row, err := s.creatureBlockFor(ctx, character, uuid.UUID(*body.ContentId), body.Role, isDM)
		if err != nil {
			return badRequest(err.Error())
		}
		// A seated hero only fields what the campaign's world admits.
		if campaignID, seated := seatedCampaign(character); seated {
			blockers, err := s.codexBlockers(ctx, campaignID, []uuid.UUID{row.ID})
			if err != nil {
				return nil, err
			}
			if len(blockers) > 0 {
				return badRequest(row.Name + " is not admitted by the campaign's codex — ask the DM")
			}
		}
		contentID = pgUUID(row.ID)
		name = row.Name
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		name = strings.TrimSpace(*body.Name)
	}
	if name == "" {
		return badRequest("a creature needs a stat block or a name")
	}
	if len([]rune(name)) > 80 {
		return badRequest("creature name must be between 1 and 80 characters")
	}

	overrides := map[string]any{}
	if body.Overrides != nil {
		overrides = *body.Overrides
	}
	if !contentID.Valid && len(overrides) == 0 {
		return badRequest("a hand-written creature needs at least one stat — start with hp and ac")
	}
	raw, err := json.Marshal(overrides)
	if err != nil {
		return badRequest("unreadable overrides")
	}

	grantedBy := ""
	if body.GrantedBy != nil {
		grantedBy = strings.TrimSpace(*body.GrantedBy)
	}
	notes := ""
	if body.Notes != nil {
		notes = *body.Notes
	}
	if len([]rune(notes)) > 2000 {
		return badRequest("notes must be 2000 characters or fewer")
	}
	if len([]rune(grantedBy)) > 80 {
		return badRequest("the granting feature's name must be 80 characters or fewer")
	}

	// No hit points are recorded: a fresh creature is undamaged, and its pool
	// is whatever the resolved block says at the hero's current level.
	created, err := s.queries.AddCharacterCreature(ctx, db.AddCharacterCreatureParams{
		CharacterID: character.ID,
		Role:        db.CreatureRole(string(body.Role)),
		ContentID:   contentID,
		Name:        name,
		GrantedBy:   grantedBy,
		Overrides:   raw,
		Notes:       notes,
	})
	if err != nil {
		return nil, err
	}
	return api.AddCharacterCreature201JSONResponse(s.freshCreature(ctx, character, created.ID)), nil
}

// creatureBlockFor resolves a chosen stat block and rules on whether this hero
// may have it. A player reaches only what their own features grant; a DM
// editing someone's sheet reaches the whole menagerie, which is the same
// authority they already have over an encounter.
func (s *Server) creatureBlockFor(ctx context.Context, c db.Character, contentID uuid.UUID, role api.CreatureRole, isDM bool) (db.RulesContent, error) {
	row, err := s.queries.GetContent(ctx, contentID)
	if err != nil || row.Kind != db.ContentKindMonster {
		return db.RulesContent{}, errors.New("unknown stat block")
	}
	if isDM {
		return row, nil
	}
	options, err := s.creatureOptions(ctx, c)
	if err != nil {
		return db.RulesContent{}, errors.New("could not read what your features grant")
	}
	granted := []api.CreatureOption{}
	granted = append(granted, options.Companions...)
	for _, form := range options.Forms {
		granted = append(granted, form.Options...)
	}
	for _, opt := range granted {
		if opt.ContentId != nil && uuid.UUID(*opt.ContentId) == contentID && opt.Role == role {
			return row, nil
		}
	}
	return db.RulesContent{}, errors.New("nothing on this sheet grants " + row.Name + " as a " + string(role))
}

// freshCreature re-reads one row through the list query's join shape.
func (s *Server) freshCreature(ctx context.Context, c db.Character, id uuid.UUID) api.CharacterCreature {
	creatures, err := s.listCreatures(ctx, c)
	if err == nil {
		for _, cr := range creatures {
			if cr.Id == id {
				return cr
			}
		}
	}
	return api.CharacterCreature{Id: id, Block: map[string]any{}, Molded: []string{}}
}

// UpdateCharacterCreature molds a creature's numbers, tracks its hit points,
// or takes the form.
func (s *Server) UpdateCharacterCreature(ctx context.Context, request api.UpdateCharacterCreatureRequestObject) (api.UpdateCharacterCreatureResponseObject, error) {
	character, row, err := s.loadCreature(ctx, uuid.UUID(request.CharacterId), request.CreatureId)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.UpdateCharacterCreature404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.UpdateCharacterCreature401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateCharacterCreature403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.UpdateCharacterCreatureResponseObject, error) {
		return api.UpdateCharacterCreature400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a patch body is required")
	}
	body := request.Body

	name := row.Name
	if body.Name != nil {
		name = strings.TrimSpace(*body.Name)
		if name == "" || len([]rune(name)) > 80 {
			return badRequest("creature name must be between 1 and 80 characters")
		}
	}

	overrides := row.Overrides
	if body.Overrides != nil {
		raw, err := json.Marshal(*body.Overrides)
		if err != nil {
			return badRequest("unreadable overrides")
		}
		overrides = raw
	}

	// A form has no pool of its own. Anything else records damage against the
	// block's hit points, clamped there — healing past full is not a bigger
	// creature, it is a full one.
	hpCurrent := row.HpCurrent
	if row.Role == db.CreatureRoleForm {
		hpCurrent = nil
	} else if body.HpCurrent != nil {
		if *body.HpCurrent < 0 {
			return badRequest("hit points cannot be negative")
		}
		var patched map[string]any
		if len(overrides) > 0 {
			_ = json.Unmarshal(overrides, &patched)
		}
		var contentData []byte
		if row.ContentID.Valid {
			if entry, err := s.queries.GetContent(ctx, uuid.UUID(row.ContentID.Bytes)); err == nil {
				contentData = entry.Data
			}
		}
		block, _, _ := rules.ResolveBlock(contentData, patched, heroScope(character))
		v := int32(*body.HpCurrent)
		if max, ok := rules.BlockHP(block); ok && int(v) > max {
			v = int32(max)
		}
		hpCurrent = &v
	}

	active := row.Active
	if body.Active != nil {
		active = *body.Active
	}
	notes := row.Notes
	if body.Notes != nil {
		notes = *body.Notes
		if len([]rune(notes)) > 2000 {
			return badRequest("notes must be 2000 characters or fewer")
		}
	}

	// One shape at a time: taking a form releases whatever else was held.
	if active && !row.Active && row.Role == db.CreatureRoleForm {
		if err := s.queries.DeactivateCharacterForms(ctx, db.DeactivateCharacterFormsParams{
			CharacterID: character.ID,
			ID:          row.ID,
		}); err != nil {
			return nil, err
		}
	}

	if _, err := s.queries.UpdateCharacterCreature(ctx, db.UpdateCharacterCreatureParams{
		ID:        row.ID,
		Name:      name,
		Overrides: overrides,
		HpCurrent: hpCurrent,
		Active:    active,
		Notes:     notes,
	}); err != nil {
		return nil, err
	}
	return api.UpdateCharacterCreature200JSONResponse(s.freshCreature(ctx, character, row.ID)), nil
}

// DeleteCharacterCreature releases a creature.
func (s *Server) DeleteCharacterCreature(ctx context.Context, request api.DeleteCharacterCreatureRequestObject) (api.DeleteCharacterCreatureResponseObject, error) {
	_, row, err := s.loadCreature(ctx, uuid.UUID(request.CharacterId), request.CreatureId)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return api.DeleteCharacterCreature404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		case errors.Is(err, errNoAuth):
			return api.DeleteCharacterCreature401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteCharacterCreature403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteCharacterCreature(ctx, row.ID); err != nil {
		return nil, err
	}
	return api.DeleteCharacterCreature204Response{}, nil
}

// GetCreatureOptions lists what this hero's features actually grant.
func (s *Server) GetCreatureOptions(ctx context.Context, request api.GetCreatureOptionsRequestObject) (api.GetCreatureOptionsResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetCreatureOptions404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireCharacterEditor(ctx, character); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetCreatureOptions401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetCreatureOptions403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	options, err := s.creatureOptions(ctx, character)
	if err != nil {
		return nil, err
	}
	return api.GetCreatureOptions200JSONResponse(options), nil
}
