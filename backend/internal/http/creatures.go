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
	"fmt"
	"reflect"
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
	return heroScopeAt(c, int(c.Level))
}

// heroScopeAt is the same hero read at a level in one class — what a Druid's
// Wild Shape means by "your Druid level" when the hero is Druid 4 / Fighter 6
// (#378: the temporary hit points of a form were read at the total).
func heroScopeAt(c db.Character, level int) rules.Scope {
	scores := map[string]int{}
	for name, ptr := range map[string]*int16{
		"str": c.Strength, "dex": c.Dexterity, "con": c.Constitution,
		"int": c.Intelligence, "wis": c.Wisdom, "cha": c.Charisma,
	} {
		if ptr != nil {
			scores[name] = int(*ptr)
		}
	}
	return rules.ScopeFor(level, scores)
}

// grantSource is one content entry that might declare a creature, kept with
// the name to stamp on whatever it grants. `level` is the level its grants
// are read at — the hero's level IN the granting class for a class or
// subclass, zero meaning "the hero's total" for everything else (species,
// background, feats, gear), per the multiclass convention.
type grantSource struct {
	name  string
	data  []byte
	level int
	// author wrote this entry when it is homebrew (uuid.Nil for the SRD). A
	// companion it names is looked for among that author's monsters first, so
	// a pack's subclass reaches the Steel Defender shipped beside it (#378).
	author uuid.UUID
}

// levelOr is the level this source's grants are read at.
func (g grantSource) levelOr(total int) int {
	if g.level > 0 {
		return g.level
	}
	return total
}

// takenFeats resolves a hero's feats, which are recorded as names, to the
// library entries they name. A background records them with their
// specialisation — "Magic Initiate (Cleric)" — so the bare name has to match
// too, the same fallback the sheet makes when it prints them. A name the
// library no longer holds is skipped.
func (s *Server) takenFeats(ctx context.Context, c db.Character) []db.RulesContent {
	if len(c.Feats) == 0 {
		return nil
	}
	feats, err := s.queries.ListContentByKind(ctx, db.ListContentByKindParams{
		Kind:      db.ContentKindFeat,
		CreatedBy: pgUUID(c.OwnerUserID),
	})
	if err != nil {
		return nil
	}
	byName := map[string]db.ListContentByKindRow{}
	for _, f := range feats {
		byName[strings.ToLower(f.Name)] = f
	}
	var out []db.RulesContent
	for _, taken := range c.Feats {
		key := strings.ToLower(strings.TrimSpace(taken))
		row, ok := byName[key]
		if !ok {
			bare := strings.TrimSpace(strings.Split(key, "(")[0])
			row, ok = byName[bare]
		}
		if ok {
			out = append(out, db.RulesContent{ID: row.ID, Name: row.Name, Data: row.Data, CreatedBy: row.CreatedBy, Source: row.Source})
		}
	}
	return out
}

// grantSources gathers everything a hero carries that could grant a creature:
// every class they hold with its subclass (#242 — it used to walk only the
// starting ClassID, so a second class granted nothing), their species and
// background, their feats, and their gear. Anything unreadable or dangling is
// skipped — a missing subclass should cost you a companion, not the page.
func (s *Server) grantSources(ctx context.Context, c db.Character) []grantSource {
	var out []grantSource
	add := func(row db.RulesContent) {
		if len(row.Data) > 0 {
			src := grantSource{name: row.Name, data: row.Data}
			if row.CreatedBy.Valid && row.Source != db.ContentSourceSrd {
				src.author = uuid.UUID(row.CreatedBy.Bytes)
			}
			out = append(out, src)
		}
	}
	// Class, subclass and gear rows come without their author; one read finds
	// whichever of them are homebrew, and who wrote them.
	var unauthored []uuid.UUID
	pending := map[int]uuid.UUID{}

	classes := s.classesFor(ctx, c)
	for _, k := range classes {
		if len(k.ClassData) > 0 {
			pending[len(out)] = k.ClassID
			out = append(out, grantSource{name: k.ClassName, data: k.ClassData, level: int(k.Level)})
		}
		if len(k.SubclassData) > 0 {
			name := k.ClassName
			if k.SubclassName != nil {
				name = *k.SubclassName
			}
			if k.SubclassID.Valid {
				pending[len(out)] = uuid.UUID(k.SubclassID.Bytes)
			}
			out = append(out, grantSource{name: name, data: k.SubclassData, level: int(k.Level)})
		}
	}
	refs := []pgtype.UUID{c.SpeciesID, c.BackgroundID}
	if len(classes) == 0 {
		// A hero with no class rows (older data, quick-adds) falls back to
		// the sheet references, read at the total level as before.
		refs = append([]pgtype.UUID{c.ClassID, c.SubclassID}, refs...)
	}
	for _, ref := range refs {
		if !ref.Valid {
			continue
		}
		if row, err := s.queries.GetContent(ctx, uuid.UUID(ref.Bytes)); err == nil {
			add(row)
		}
	}

	for _, row := range s.takenFeats(ctx, c) {
		add(row)
	}

	// Gear counts: a figurine that becomes a beast is an item that grants a
	// companion, and content says so the same way a subclass does.
	if items, err := s.queries.ListCharacterItems(ctx, c.ID); err == nil {
		for _, it := range items {
			if it.ContentID.Valid && len(it.Data) > 0 {
				pending[len(out)] = uuid.UUID(it.ContentID.Bytes)
				out = append(out, grantSource{name: it.Name, data: it.Data})
			}
		}
	}

	for _, id := range pending {
		unauthored = append(unauthored, id)
	}
	if len(unauthored) > 0 {
		if rows, err := s.queries.ContentAuthors(ctx, unauthored); err == nil {
			author := map[uuid.UUID]uuid.UUID{}
			for _, r := range rows {
				author[r.ID] = r.Author
			}
			for i, id := range pending {
				out[i].author = author[id]
			}
		}
	}
	return out
}

/*
visibleMonsters is the pool a hero's creatures may be drawn from: the SRD, the
owner's own homebrew, the homebrew of whoever wrote the features granting the
hero a creature, and — for a seated hero — the table's DMs' (#378).

A monster never enters the codex (a codex row would leak it into the player's
view), so until this a homebrew companion could not be fielded at any table:
the add checked the codex, and the codex refused monsters. A monster is now
admitted by what names it. The subclass, feat or item that grants it already
answered to the codex when the hero sat down, so its author's Steel Defender
comes with it; and a DM's beasts are their own table's to offer. Narrowing to
what the hero's features actually grant is still the caller's job.
*/
func (s *Server) visibleMonsters(ctx context.Context, c db.Character, sources []grantSource) ([]db.RulesContent, error) {
	authors := []uuid.UUID{c.OwnerUserID}
	for _, src := range sources {
		if src.author != uuid.Nil {
			authors = append(authors, src.author)
		}
	}
	if campaignID, seated := seatedCampaign(c); seated {
		if dms, err := s.dmsAt(ctx, campaignID); err == nil {
			authors = append(authors, dms...)
		}
	}
	return s.queries.ListMonstersForCreatures(ctx, authors)
}

// monsterNamed picks the block a grant's name means. The SRD's own entry
// first, so a homebrew shadow never replaces what a book feature points at;
// then the grant's own author's, so a pack's subclass finds the monster its
// pack shipped; then the hero owner's; then anyone's in the pool.
func monsterNamed(byName map[string][]db.RulesContent, name string, grant, owner uuid.UUID) (db.RulesContent, bool) {
	rows := byName[strings.ToLower(name)]
	if len(rows) == 0 {
		return db.RulesContent{}, false
	}
	for _, want := range []func(db.RulesContent) bool{
		func(r db.RulesContent) bool { return r.Source == db.ContentSourceSrd },
		func(r db.RulesContent) bool {
			return grant != uuid.Nil && r.CreatedBy.Valid && uuid.UUID(r.CreatedBy.Bytes) == grant
		},
		func(r db.RulesContent) bool { return r.CreatedBy.Valid && uuid.UUID(r.CreatedBy.Bytes) == owner },
	} {
		for _, r := range rows {
			if want(r) {
				return r, true
			}
		}
	}
	return rows[0], true
}

// creatureOptions answers "what may this hero have?" — the forms their
// shapeshifting features admit, and the companions their features name.
func (s *Server) creatureOptions(ctx context.Context, c db.Character) (api.CreatureOptions, error) {
	out := api.CreatureOptions{Forms: []api.FormAllowance{}, Companions: []api.CreatureOption{}}
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
	monsters, err := s.visibleMonsters(ctx, c, sources)
	if err != nil {
		return out, err
	}
	byName := map[string][]db.RulesContent{}
	for _, m := range monsters {
		key := strings.ToLower(m.Name)
		byName[key] = append(byName[key], m)
	}

	option := func(row db.RulesContent, role api.CreatureRole, grantedBy, summary string, scope rules.Scope) api.CreatureOption {
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
		// A class's grants are read at the hero's level IN that class (#242),
		// and so are the formulas inside them.
		srcLevel := src.levelOr(int(c.Level))
		scope := heroScopeAt(c, srcLevel)

		for _, grant := range companions {
			if grant.Level > srcLevel {
				continue
			}
			row, ok := monsterNamed(byName, grant.Name, src.author, c.OwnerUserID)
			if !ok {
				continue // names a block this instance does not have
			}
			role := api.CreatureRole(grant.Role)
			if !role.Valid() {
				role = api.Companion
			}
			out.Companions = append(out.Companions, option(row, role, src.name, grant.Summary, scope))
		}

		allowance, ok := forms.At(srcLevel, scope)
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
				choices = append(choices, option(m, api.Form, feature, "", scope))
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
	best := 0
	for _, src := range s.grantSources(ctx, c) {
		_, forms := rules.GrantsIn(src.data)
		level := src.levelOr(int(c.Level))
		if allowance, ok := forms.At(level, heroScopeAt(c, level)); ok && allowance.TempHP > best {
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
	locked := tableLocked(character, member)

	grantedBy := ""
	if body.GrantedBy != nil {
		grantedBy = strings.TrimSpace(*body.GrantedBy)
	}

	name := ""
	var contentID pgtype.UUID
	if body.ContentId != nil {
		// Admitted by what names it (#378): the grant was ruled on when the hero
		// sat down, so there is no codex row to ask about a monster — and there
		// never could be one, since the codex refuses monsters.
		row, err := s.creatureBlockFor(ctx, character, uuid.UUID(*body.ContentId), body.Role, isDM)
		if err != nil {
			return badRequest(err.Error())
		}
		if body.Role == api.Form && !isDM {
			feature, msg, err := s.formRoom(ctx, character, row.ID)
			if err != nil {
				return nil, err
			}
			if msg != "" {
				return badRequest(msg)
			}
			grantedBy = feature
		}
		contentID = pgUUID(row.ID)
		name = row.Name
	} else if locked {
		return badRequest("at a table, a creature written by hand is the DM's to add — ask them")
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
	if locked && len(overrides) > 0 {
		return badRequest("at a table, a creature's numbers are the DM's — take it as it stands")
	}
	raw, err := json.Marshal(overrides)
	if err != nil {
		return badRequest("unreadable overrides")
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

/*
tableLocked is whether this caller may only take a hero's creatures as they
stand (#378). At a table the numbers are the table's: a player renames their
wolf, writes notes on it and tracks its hit points, but changing its stats or
writing a creature by hand is the DM's — the same line the DM already holds
over everything else on a seated sheet. An unseated hero is the owner's own
sandbox, as before.
*/
func tableLocked(c db.Character, member db.Membership) bool {
	_, seated := seatedCampaign(c)
	return seated && member.Role != db.MembershipRoleDm
}

// formRoom checks a form against the shapeshifting feature that offers it: a
// Druid knows only so many shapes (#378 — nothing counted them), and knows a
// shape once. It answers the feature's name, which the row records as what
// granted it, or why there is no room.
func (s *Server) formRoom(ctx context.Context, c db.Character, contentID uuid.UUID) (string, string, error) {
	options, err := s.creatureOptions(ctx, c)
	if err != nil {
		return "", "", err
	}
	held, err := s.queries.ListCharacterCreatures(ctx, c.ID)
	if err != nil {
		return "", "", err
	}
	for _, allowance := range options.Forms {
		offered := false
		for _, o := range allowance.Options {
			if o.ContentId != nil && uuid.UUID(*o.ContentId) == contentID {
				offered = true
			}
		}
		if !offered {
			continue
		}
		known := 0
		for _, h := range held {
			if h.Role != db.CreatureRoleForm || !strings.EqualFold(h.GrantedBy, allowance.Feature) {
				continue
			}
			if h.ContentID.Valid && uuid.UUID(h.ContentID.Bytes) == contentID {
				return "", "this hero already knows " + h.Name, nil
			}
			known++
		}
		if known >= allowance.Known {
			return "", fmt.Sprintf("%s knows %d forms at this level — release one first", allowance.Feature, allowance.Known), nil
		}
		return allowance.Feature, "", nil
	}
	return "", "", nil
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
		if !sameJSON(raw, row.Overrides) {
			member, err := s.requireCharacterEditor(ctx, character)
			if err != nil {
				return nil, err
			}
			if tableLocked(character, member) {
				return badRequest("at a table, a creature's numbers are the DM's — ask them to change it")
			}
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

	// Taking a form spends a use of the pool its feature keeps, when the hero
	// has one — a Druid's Wild Shape rows and their Wild Shape pool share a
	// name by declaration, not by code, so a pack's shapeshifter pays the same
	// way. An empty pool refuses the change, which is the rule; a table that
	// rules otherwise still has the pips to hand-edit. Dropping a form refunds
	// nothing — a use spent is spent.
	taking := active && !row.Active && row.Role == db.CreatureRoleForm
	var spentPools []byte
	if taking && row.GrantedBy != "" {
		for _, pool := range s.resolvePools(ctx, character) {
			if !strings.EqualFold(pool.Name, row.GrantedBy) {
				continue
			}
			if pool.Used >= pool.Max {
				return badRequest("no uses of " + pool.Name + " left — rest first")
			}
			used := poolsUsedIn(character)
			used[pool.Name] = pool.Used + 1
			raw, err := json.Marshal(used)
			if err != nil {
				return nil, err
			}
			spentPools = raw
			break
		}
	}

	// One shape at a time: taking a form releases whatever else was held. The
	// release, the spend and the change move together or not at all.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	if taking {
		if err := qtx.DeactivateCharacterForms(ctx, db.DeactivateCharacterFormsParams{
			CharacterID: character.ID,
			ID:          row.ID,
		}); err != nil {
			return nil, err
		}
	}
	if spentPools != nil {
		if _, err := qtx.SetPoolsUsed(ctx, db.SetPoolsUsedParams{
			ID:        character.ID,
			PoolsUsed: spentPools,
		}); err != nil {
			return nil, err
		}
	}
	if _, err := qtx.UpdateCharacterCreature(ctx, db.UpdateCharacterCreatureParams{
		ID:        row.ID,
		Name:      name,
		Overrides: overrides,
		HpCurrent: hpCurrent,
		Active:    active,
		Notes:     notes,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
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

// sameJSON is whether two JSON documents say the same thing, however they are
// spaced or ordered — a patch that resends what is stored changes nothing.
func sameJSON(a, b []byte) bool {
	var x, y any
	if len(a) == 0 {
		a = []byte("{}")
	}
	if len(b) == 0 {
		b = []byte("{}")
	}
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}
