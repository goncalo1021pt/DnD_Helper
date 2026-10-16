package http

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

/*
The tools (#318). Each one reads through the strict handlers and writes
markdown — short, with ids, so the next call can name what this one read.

The scopes beside each are the union of what the handlers it calls declare in
the spec, because calling a handler in-process skips scopeGate: this list is
the gate. A DM-only tool also needs its handler's own DM check (requireDM, or
the Den's isDMAnywhere) — the scope says what kind of thing may be touched,
the guard still says who the caller is to it.
*/

var mcpTools = []mcpTool{
	{"my_tables", []auth.Scope{auth.CampaignsRead}, addMyTables},
	{"my_heroes", []auth.Scope{auth.HeroesRead}, addMyHeroes},
	{"hero_sheet", []auth.Scope{auth.HeroesRead, auth.CampaignsRead}, addHeroSheet},
	{"lookup", []auth.Scope{auth.RulesRead}, addLookup},
	{"table_board", []auth.Scope{auth.CampaignsRead}, addTableBoard},
	{"chronicle", []auth.Scope{auth.CampaignsRead}, addChronicle},
	{"whats_known", []auth.Scope{auth.CampaignsRead}, addWhatsKnown},
	{"party", []auth.Scope{auth.CampaignsRead}, addParty},
	{"den_search", []auth.Scope{auth.RulesRead, auth.CampaignsRun}, addDenSearch},
	{"encounter_check", []auth.Scope{auth.RulesRead, auth.CampaignsRun}, addEncounterCheck},
}

// hiddenMark is what a DM reads beside a thing the party cannot see. A
// player's payload never carries the flag, so a player never reads it.
func hiddenMark(visible *bool) string {
	if visible != nil && !*visible {
		return " _(hidden from the party)_"
	}
	return ""
}

func when(t *time.Time) string {
	if t == nil {
		return "not scheduled"
	}
	return t.UTC().Format("Mon 2 Jan 2006, 15:04 UTC")
}

// firstLine is the opening line of some prose, cut to n runes.
func firstLine(s string, n int) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return excerpt(s, n)
}

// heroClassLine is a hero's classes as the sheet reads them, falling back to the
// freeform line a quick-add carries.
func heroClassLine(c api.Character) string {
	if c.Sheet != nil && c.Sheet.Classes != nil && len(*c.Sheet.Classes) > 0 {
		parts := make([]string, 0, len(*c.Sheet.Classes))
		for _, k := range *c.Sheet.Classes {
			p := fmt.Sprintf("%s %d", k.ClassName, k.Level)
			if k.SubclassName != nil && *k.SubclassName != "" {
				p += " (" + *k.SubclassName + ")"
			}
			parts = append(parts, p)
		}
		return strings.Join(parts, " / ")
	}
	if strings.TrimSpace(c.Class) == "" {
		return fmt.Sprintf("level %d", c.Level)
	}
	return fmt.Sprintf("%s, level %d", c.Class, c.Level)
}

// --- my_tables ------------------------------------------------------------

type noInput struct{}

func addMyTables(t *toolbox) {
	tool(t, "my_tables", "My tables",
		"The tables (campaigns) you sit at: your role at each, its realm, and when the next session is. Start here.",
		func(ctx context.Context, _ noInput) (string, error) {
			tables, ok, err := as[api.ListCampaigns200JSONResponse](t.s.ListCampaigns(ctx, api.ListCampaignsRequestObject{}))
			if err != nil {
				return "", err
			}
			if !ok || len(tables) == 0 {
				return "You sit at no tables this token can reach.", nil
			}
			var b strings.Builder
			b.WriteString("# Your tables\n\n")
			for _, tb := range tables {
				role := "player"
				if tb.Role == api.Dm {
					role = "DM"
					if tb.Campaign.OwnerUserId == t.uid {
						role = "DM (owner)"
					}
				}
				fmt.Fprintf(&b, "- **%s** (`%s`) — you are %s", tb.Campaign.Name, tb.Campaign.Id, role)
				if tb.Campaign.RealmName != "" && tb.Campaign.RealmName != tb.Campaign.Name {
					fmt.Fprintf(&b, " · realm %s", tb.Campaign.RealmName)
				}
				fmt.Fprintf(&b, " · next session: %s\n", when(tb.Campaign.NextSessionAt))
			}
			return b.String(), nil
		})
}

// --- my_heroes ------------------------------------------------------------

func addMyHeroes(t *toolbox) {
	tool(t, "my_heroes", "My heroes",
		"The heroes you play: class and level, and the table each sits at.",
		func(ctx context.Context, _ noInput) (string, error) {
			mine, ok, err := as[api.ListMyCharacters200JSONResponse](t.s.ListMyCharacters(ctx, api.ListMyCharactersRequestObject{}))
			if err != nil {
				return "", err
			}
			if !ok || len(mine) == 0 {
				return "You have no heroes.", nil
			}
			var b strings.Builder
			b.WriteString("# Your heroes\n\n")
			for _, c := range mine {
				fmt.Fprintf(&b, "- **%s** (`%s`) — %s", c.Name, c.Id, heroClassLine(c))
				if c.CampaignName != nil {
					fmt.Fprintf(&b, " · at %s", *c.CampaignName)
				} else {
					b.WriteString(" · not seated")
				}
				if c.PartyName != nil {
					fmt.Fprintf(&b, " · rides with %s", *c.PartyName)
				}
				b.WriteString("\n")
			}
			return b.String(), nil
		})
}

// --- hero_sheet -----------------------------------------------------------

type heroInput struct {
	Hero  string `json:"hero" jsonschema:"the hero's id or name — one of yours, or one at a table you sit at"`
	Table string `json:"table,omitempty" jsonschema:"optional: the table to look for the hero at, by id or name"`
}

// heroRef finds a hero by id or name: the caller's own first, then the
// rosters of their tables (a DM's whole table; a player's own party).
func (s *Server) heroRef(ctx context.Context, ref, table string) (uuid.UUID, error) {
	ref = strings.TrimSpace(ref)
	if id, err := uuid.Parse(ref); err == nil {
		return id, nil
	}
	if ref == "" {
		return uuid.Nil, refuse("Which hero?")
	}
	var pool []api.Character
	if table == "" {
		if mine, ok, err := as[api.ListMyCharacters200JSONResponse](s.ListMyCharacters(ctx, api.ListMyCharactersRequestObject{})); err != nil {
			return uuid.Nil, err
		} else if ok {
			pool = append(pool, mine...)
		}
	}
	if hit, err := pickOne(pool, ref, "hero", func(c api.Character) uuid.UUID { return c.Id }, func(c api.Character) string { return c.Name }); err == nil {
		return hit.Id, nil
	}
	var tables []api.CampaignMembership
	if table != "" {
		tb, err := s.tableRef(ctx, table)
		if err != nil {
			return uuid.Nil, err
		}
		tables = []api.CampaignMembership{tb}
	} else if all, ok, err := as[api.ListCampaigns200JSONResponse](s.ListCampaigns(ctx, api.ListCampaignsRequestObject{})); err != nil {
		return uuid.Nil, err
	} else if ok {
		tables = all
	}
	seen := map[uuid.UUID]bool{}
	for _, c := range pool {
		seen[c.Id] = true
	}
	for _, tb := range tables {
		roster, ok, err := as[api.ListCharacters200JSONResponse](s.ListCharacters(ctx, api.ListCharactersRequestObject{CampaignId: tb.Campaign.Id}))
		if err != nil {
			return uuid.Nil, err
		}
		for _, c := range roster {
			if ok && !seen[c.Id] {
				seen[c.Id] = true
				pool = append(pool, c)
			}
		}
	}
	hit, err := pickOne(pool, ref, "hero", func(c api.Character) uuid.UUID { return c.Id }, func(c api.Character) string { return c.Name })
	return hit.Id, err
}

func signed(n int) string {
	if n >= 0 {
		return fmt.Sprintf("+%d", n)
	}
	return fmt.Sprint(n)
}

func addHeroSheet(t *toolbox) {
	tool(t, "hero_sheet", "Hero sheet",
		"A hero's sheet with the numbers worked out: classes, abilities, AC, HP, hit dice, spell slots, resource pools, spells, features, gear and companions. The same sheet the app shows — a hidden sheet stays hidden.",
		func(ctx context.Context, in heroInput) (string, error) {
			id, err := t.s.heroRef(ctx, in.Hero, in.Table)
			if err != nil {
				return "", err
			}
			d, ok, err := as[api.GetCharacter200JSONResponse](t.s.GetCharacter(ctx, api.GetCharacterRequestObject{CharacterId: id}))
			if err != nil {
				return "", err
			}
			if !ok {
				return "", notReadable("That hero")
			}
			return t.s.renderSheet(ctx, api.CharacterDetail(d))
		})
}

func (s *Server) renderSheet(ctx context.Context, d api.CharacterDetail) (string, error) {
	c := d.Character
	var b strings.Builder
	fmt.Fprintf(&b, "# %s (`%s`)\n\n%s · played by %s", c.Name, c.Id, heroClassLine(c), c.OwnerName)
	if c.CampaignName != nil {
		fmt.Fprintf(&b, " · at %s", *c.CampaignName)
	}
	if c.PartyName != nil {
		fmt.Fprintf(&b, " · rides with %s", *c.PartyName)
	}
	b.WriteString("\n\n")

	row, err := s.queries.GetCharacter(ctx, c.Id)
	if err != nil {
		return "", err
	}
	if row.SpeciesID.Valid {
		if sp, err := s.queries.GetContent(ctx, uuid.UUID(row.SpeciesID.Bytes)); err == nil {
			fmt.Fprintf(&b, "Species: %s. ", sp.Name)
		}
	}
	if row.BackgroundID.Valid {
		if bg, err := s.queries.GetContent(ctx, uuid.UUID(row.BackgroundID.Bytes)); err == nil {
			fmt.Fprintf(&b, "Background: %s.", bg.Name)
		}
	}
	b.WriteString("\n\n")

	prof := 2 + (c.Level-1)/4
	ac, err := s.heroArmorClass(ctx, row)
	if err != nil {
		return "", err
	}
	fmt.Fprintf(&b, "**HP** %d / %d · **AC** %d · **Proficiency** %s", c.HpCurrent, c.HpMax, ac, signed(prof))
	if c.Xp != nil {
		fmt.Fprintf(&b, " · **XP** %d", *c.Xp)
	}
	if c.PendingLevels != nil && *c.PendingLevels > 0 {
		fmt.Fprintf(&b, " · %d level(s) waiting to be taken", *c.PendingLevels)
	}
	b.WriteString("\n\n")

	if sh := c.Sheet; sh != nil {
		a := sh.Abilities
		fmt.Fprintf(&b, "| STR | DEX | CON | INT | WIS | CHA |\n|---|---|---|---|---|---|\n| %d (%s) | %d (%s) | %d (%s) | %d (%s) | %d (%s) | %d (%s) |\n\n",
			a.Str, signed(abilityMod(a.Str)), a.Dex, signed(abilityMod(a.Dex)), a.Con, signed(abilityMod(a.Con)),
			a.Int, signed(abilityMod(a.Int)), a.Wis, signed(abilityMod(a.Wis)), a.Cha, signed(abilityMod(a.Cha)))
		if len(sh.Skills) > 0 {
			fmt.Fprintf(&b, "**Skills** %s\n\n", strings.Join(sh.Skills, ", "))
		}
		if sh.Feats != nil && len(*sh.Feats) > 0 {
			fmt.Fprintf(&b, "**Feats** %s\n\n", strings.Join(*sh.Feats, ", "))
		}
		if c.HitDice != nil && len(*c.HitDice) > 0 {
			parts := []string{}
			for _, h := range *c.HitDice {
				parts = append(parts, fmt.Sprintf("%d/%d d%d", h.Max-h.Used, h.Max, h.Die))
			}
			fmt.Fprintf(&b, "**Hit dice left** %s\n\n", strings.Join(parts, ", "))
		}
		if sh.SpellSlots != nil && len(*sh.SpellSlots) > 0 {
			parts := []string{}
			for _, sl := range *sh.SpellSlots {
				parts = append(parts, fmt.Sprintf("L%d %d/%d", sl.Level, sl.Max-sl.Used, sl.Max))
			}
			fmt.Fprintf(&b, "**Spell slots left** %s\n\n", strings.Join(parts, ", "))
		}
		if sh.PactSlots != nil && sh.PactSlots.Max > 0 {
			fmt.Fprintf(&b, "**Pact slots left** %d/%d at level %d\n\n", sh.PactSlots.Max-sh.PactSlots.Used, sh.PactSlots.Max, sh.PactSlots.Level)
		}
		if sh.Pools != nil && len(*sh.Pools) > 0 {
			b.WriteString("**Resources**\n\n")
			for _, p := range *sh.Pools {
				fmt.Fprintf(&b, "- %s: %d/%d (from %s; short rest: %s)\n", p.Name, p.Max-p.Used, p.Max, p.GrantedBy, p.ShortRest)
			}
			b.WriteString("\n")
		}
	}

	if len(d.Spells) > 0 {
		names := map[uuid.UUID]api.RulesContent{}
		for _, sp := range d.Spells {
			names[sp.Id] = sp
		}
		spellName := func(id uuid.UUID) string {
			sp := names[id]
			lvl, _ := sp.Data["level"].(float64)
			if lvl == 0 {
				return sp.Name + " (cantrip)"
			}
			return fmt.Sprintf("%s (L%d)", sp.Name, int(lvl))
		}
		b.WriteString("## Spells\n\n")
		listed := map[uuid.UUID]bool{}
		if d.Casters != nil {
			for _, cs := range *d.Casters {
				always := map[uuid.UUID]bool{}
				if cs.AlwaysPreparedIds != nil {
					for _, id := range *cs.AlwaysPreparedIds {
						always[id] = true
					}
				}
				parts := []string{}
				for _, id := range cs.SpellIds {
					listed[id] = true
					n := spellName(id)
					if always[id] {
						n += " — always prepared"
					}
					parts = append(parts, n)
				}
				fmt.Fprintf(&b, "**%s** (casts with %s): %s\n\n", cs.ClassName, strings.ToUpper(cs.Ability), strings.Join(parts, "; "))
			}
		}
		rest := []string{}
		for _, sp := range d.Spells {
			if !listed[sp.Id] {
				rest = append(rest, spellName(sp.Id))
			}
		}
		if len(rest) > 0 {
			fmt.Fprintf(&b, "**Other spells**: %s\n\n", strings.Join(rest, "; "))
		}
	}

	if sources := s.grantSources(ctx, row); len(sources) > 0 {
		var feats strings.Builder
		for _, src := range sources {
			earned := earnedFeatures(src.data, src.levelOr(int(row.Level)))
			if len(earned) == 0 {
				continue
			}
			parts := make([]string, 0, len(earned))
			for _, f := range earned {
				parts = append(parts, f.Name)
			}
			fmt.Fprintf(&feats, "- **%s**: %s\n", src.name, strings.Join(parts, ", "))
		}
		if feats.Len() > 0 {
			b.WriteString("## Features\n\n")
			b.WriteString(feats.String())
			b.WriteString("\n_Use lookup for what a feature does._\n\n")
		}
	}

	if len(d.Items) > 0 {
		b.WriteString("## Gear\n\n")
		for _, it := range d.Items {
			fmt.Fprintf(&b, "- %s", it.Name)
			if it.Qty != 1 {
				fmt.Fprintf(&b, " ×%d", it.Qty)
			}
			tags := []string{}
			if it.Equipped {
				tags = append(tags, "equipped")
			}
			if it.Attuned {
				tags = append(tags, "attuned")
			}
			if it.IsPurse != nil && *it.IsPurse {
				tags = append(tags, "purse")
			}
			if len(tags) > 0 {
				fmt.Fprintf(&b, " _(%s)_", strings.Join(tags, ", "))
			}
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	if len(d.Creatures) > 0 {
		b.WriteString("## Companions and forms\n\n")
		for _, cr := range d.Creatures {
			fmt.Fprintf(&b, "- %s (%s)", cr.Name, cr.Role)
			if cr.HpMax != nil {
				cur := *cr.HpMax
				if cr.HpCurrent != nil {
					cur = *cr.HpCurrent
				}
				fmt.Fprintf(&b, " HP %d/%d", cur, *cr.HpMax)
			}
			if cr.Active {
				b.WriteString(" — active")
			}
			b.WriteString("\n")
		}
	}
	return b.String(), nil
}

// --- lookup ---------------------------------------------------------------

type lookupInput struct {
	Name string `json:"name" jsonschema:"the entry's name, or part of it"`
	Kind string `json:"kind,omitempty" jsonschema:"optional: spell, class, subclass, species, background, feat, item, rule or monster (monsters are the DM's)"`
}

var lookupKinds = []api.ContentKind{"spell", "feat", "item", "class", "subclass", "species", "background", "rule", "monster"}

func addLookup(t *toolbox) {
	tool(t, "lookup", "Look up a rule",
		"Read an entry from the rules codex — the SRD and the homebrew you can see — by name: a spell, class, subclass, species, background, feat, item, rule, or (for a DM) a monster.",
		func(ctx context.Context, in lookupInput) (string, error) {
			kinds := lookupKinds
			if k := strings.ToLower(strings.TrimSpace(in.Kind)); k != "" {
				kinds = nil
				for _, known := range lookupKinds {
					if string(known) == k {
						kinds = []api.ContentKind{known}
					}
				}
				if kinds == nil {
					return "", refuse("Unknown kind %q.", in.Kind)
				}
			}
			var pool []api.RulesContent
			for _, k := range kinds {
				list, ok, err := as[api.ListRules200JSONResponse](t.s.ListRules(ctx, api.ListRulesRequestObject{Kind: k}))
				if err != nil {
					return "", err
				}
				if ok {
					pool = append(pool, list...)
				}
			}
			hit, err := pickOne(pool, strings.TrimSpace(in.Name), "entry", func(r api.RulesContent) uuid.UUID { return r.Id }, func(r api.RulesContent) string { return r.Name })
			if err != nil {
				return "", err
			}
			return renderEntry(hit), nil
		})
}

// renderEntry writes a codex entry: its short fields as a list, then its
// prose, then any features by level.
func renderEntry(r api.RulesContent) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n_%s · %s_", r.Name, r.Kind, r.Source)
	if r.CreatorName != nil {
		fmt.Fprintf(&b, " _by %s_", *r.CreatorName)
	}
	b.WriteString("\n\n")
	if r.Summary != "" {
		b.WriteString(r.Summary + "\n\n")
	}
	keys := make([]string, 0, len(r.Data))
	for k := range r.Data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		switch k {
		case "description", "features", "featuresTable", "traits", "choices", "book", "startingEquipment", "pools", "companions", "forms", "scale":
			continue
		}
		switch v := r.Data[k].(type) {
		case string, float64, bool:
			fmt.Fprintf(&b, "- **%s**: %v\n", k, v)
		case []any:
			parts := []string{}
			for _, x := range v {
				if s, ok := x.(string); ok {
					parts = append(parts, s)
				}
			}
			if len(parts) == len(v) && len(parts) > 0 {
				fmt.Fprintf(&b, "- **%s**: %s\n", k, strings.Join(parts, ", "))
			}
		case map[string]any:
			if raw, err := json.Marshal(v); err == nil && len(raw) < 200 {
				fmt.Fprintf(&b, "- **%s**: %s\n", k, raw)
			}
		}
	}
	if desc, _ := r.Data["description"].(string); desc != "" {
		b.WriteString("\n" + desc + "\n")
	}
	if table, _ := r.Data["featuresTable"].([]any); len(table) > 0 {
		writeFeaturesTable(&b, table)
	}
	for _, key := range []string{"traits", "features"} {
		list, _ := r.Data[key].([]any)
		if len(list) == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n## %s\n\n", strings.ToUpper(key[:1])+key[1:])
		for _, x := range list {
			f, _ := x.(map[string]any)
			name, _ := f["name"].(string)
			text, _ := f["summary"].(string)
			if text == "" {
				text, _ = f["description"].(string)
			}
			if lvl, ok := f["level"].(float64); ok && lvl > 0 {
				fmt.Fprintf(&b, "**Level %d — %s.** %s\n\n", int(lvl), name, text)
			} else {
				fmt.Fprintf(&b, "**%s.** %s\n\n", name, text)
			}
		}
	}
	return b.String()
}

// writeFeaturesTable draws a class's per-level columns (Rages, Cantrips,
// Focus Points …) as one table, a row per level: the thing that answers
// "what changes at 5".
func writeFeaturesTable(b *strings.Builder, table []any) {
	type column struct {
		name   string
		values []any
	}
	var cols []column
	for _, x := range table {
		c, _ := x.(map[string]any)
		name, _ := c["name"].(string)
		values, _ := c["values"].([]any)
		if name != "" && len(values) > 0 {
			cols = append(cols, column{name, values})
		}
	}
	if len(cols) == 0 {
		return
	}
	b.WriteString("\n## By level\n\n| Level |")
	for _, c := range cols {
		b.WriteString(" " + c.name + " |")
	}
	b.WriteString("\n|---|" + strings.Repeat("---|", len(cols)) + "\n")
	for lvl := 0; lvl < 20; lvl++ {
		fmt.Fprintf(b, "| %d |", lvl+1)
		for _, c := range cols {
			v := ""
			if lvl < len(c.values) {
				v = fmt.Sprint(c.values[lvl])
			}
			b.WriteString(" " + v + " |")
		}
		b.WriteString("\n")
	}
}

// --- table_board ----------------------------------------------------------

type tableInput struct {
	Table string `json:"table,omitempty" jsonschema:"the table's id or name; may be left out when you sit at only one"`
}

func addTableBoard(t *toolbox) {
	tool(t, "table_board", "Table board",
		"A table at a glance: the next session, the quests on the board (with who claimed them and their rewards), and the latest chronicle lines.",
		func(ctx context.Context, in tableInput) (string, error) {
			tb, err := t.s.tableRef(ctx, in.Table)
			if err != nil {
				return "", err
			}
			id := tb.Campaign.Id
			var b strings.Builder
			fmt.Fprintf(&b, "# %s\n\nNext session: %s\n\n", tb.Campaign.Name, when(tb.Campaign.NextSessionAt))

			quests, ok, err := as[api.ListQuests200JSONResponse](t.s.ListQuests(ctx, api.ListQuestsRequestObject{CampaignId: id}))
			if err != nil {
				return "", err
			}
			if !ok {
				return "", notReadable("That table")
			}
			order := map[api.QuestStatus]int{api.QuestStatusActive: 0, api.QuestStatusAvailable: 1, api.QuestStatusCompleted: 2, api.QuestStatusFailed: 3}
			sort.SliceStable(quests, func(i, j int) bool { return order[quests[i].Status] < order[quests[j].Status] })
			b.WriteString("## Quests\n\n")
			if len(quests) == 0 {
				b.WriteString("_The board is empty._\n")
			}
			for _, q := range quests {
				fmt.Fprintf(&b, "- **%s** (`%s`) — %s, %s", q.Title, q.Id, q.Status, q.Difficulty)
				if q.Location != nil && *q.Location != "" {
					fmt.Fprintf(&b, " · at %s", *q.Location)
				}
				if q.Giver != nil && *q.Giver != "" {
					fmt.Fprintf(&b, " · from %s", *q.Giver)
				}
				b.WriteString(hiddenMark(q.VisibleToParty))
				if q.HiddenByLocation != nil && *q.HiddenByLocation {
					b.WriteString(" _(its place is hidden from the party)_")
				}
				if len(q.Claims) > 0 {
					who := []string{}
					for _, c := range q.Claims {
						if c.HeroName != nil {
							who = append(who, *c.HeroName)
						} else {
							who = append(who, c.UserName)
						}
					}
					fmt.Fprintf(&b, " · claimed by %s", strings.Join(who, ", "))
				}
				if len(q.Rewards) > 0 {
					rw := []string{}
					for _, r := range q.Rewards {
						if r.Value != nil && *r.Value != "" {
							rw = append(rw, fmt.Sprintf("%s (%s)", r.Label, *r.Value))
						} else {
							rw = append(rw, r.Label)
						}
					}
					fmt.Fprintf(&b, " · rewards: %s", strings.Join(rw, ", "))
				}
				if d := firstLine(q.Description, 200); d != "" {
					fmt.Fprintf(&b, "\n  %s", d)
				}
				b.WriteString("\n")
			}

			limit := 10
			events, ok, err := as[api.ListEvents200JSONResponse](t.s.ListEvents(ctx, api.ListEventsRequestObject{CampaignId: id, Params: api.ListEventsParams{Limit: &limit}}))
			if err != nil {
				return "", err
			}
			if ok && len(events) > 0 {
				b.WriteString("\n## Latest in the chronicle\n\n")
				writeEvents(&b, events)
				b.WriteString("\n_Use chronicle for more._\n")
			}
			return b.String(), nil
		})
}

// --- chronicle ------------------------------------------------------------

type chronicleInput struct {
	Table    string `json:"table,omitempty" jsonschema:"the table's id or name; may be left out when you sit at only one"`
	Limit    int    `json:"limit,omitempty" jsonschema:"how many lines, newest first (default 50, at most 200)"`
	Category string `json:"category,omitempty" jsonschema:"optional: dm (story notes), rules (rulings), player (table chat) or log (what happened in the app)"`
	Since    string `json:"since,omitempty" jsonschema:"optional: only lines from this date on, as YYYY-MM-DD"`
}

func writeEvents(b *strings.Builder, events []api.ChronicleEvent) {
	// Oldest first reads as a story; the handler hands them newest first.
	for i := len(events) - 1; i >= 0; i-- {
		e := events[i]
		who := ""
		if e.ActorName != nil && *e.ActorName != "" {
			who = *e.ActorName + ": "
		}
		fmt.Fprintf(b, "- %s [%s] %s%s\n", e.CreatedAt.UTC().Format("2006-01-02 15:04"), e.Category, who, strings.TrimSpace(e.Message))
	}
}

func addChronicle(t *toolbox) {
	tool(t, "chronicle", "Chronicle",
		"Read a table's chronicle back, oldest to newest: story notes, rulings, table chat and the log of what happened. Good for summarising past sessions. Lines are written by the people at the table.",
		func(ctx context.Context, in chronicleInput) (string, error) {
			tb, err := t.s.tableRef(ctx, in.Table)
			if err != nil {
				return "", err
			}
			limit := in.Limit
			if limit <= 0 {
				limit = 50
			}
			limit = min(limit, 200)
			params := api.ListEventsParams{Limit: &limit}
			if c := strings.TrimSpace(in.Category); c != "" {
				if !validFilterCategory(c) {
					return "", refuse("Unknown category %q: use dm, rules, player or log.", c)
				}
				params.Category = &c
			}
			events, ok, err := as[api.ListEvents200JSONResponse](t.s.ListEvents(ctx, api.ListEventsRequestObject{CampaignId: tb.Campaign.Id, Params: params}))
			if err != nil {
				return "", err
			}
			if !ok {
				return "", notReadable("That table")
			}
			if in.Since != "" {
				since, err := time.Parse("2006-01-02", in.Since)
				if err != nil {
					return "", refuse("since must be a date, YYYY-MM-DD.")
				}
				kept := events[:0]
				for _, e := range events {
					if !e.CreatedAt.Before(since) {
						kept = append(kept, e)
					}
				}
				events = kept
			}
			if len(events) == 0 {
				return fmt.Sprintf("Nothing in the chronicle of %s for that.", tb.Campaign.Name), nil
			}
			var b strings.Builder
			fmt.Fprintf(&b, "# Chronicle of %s\n\n", tb.Campaign.Name)
			writeEvents(&b, events)
			return b.String(), nil
		})
}

// --- whats_known ----------------------------------------------------------

type knownInput struct {
	Table string `json:"table,omitempty" jsonschema:"the table's id or name; may be left out when you sit at only one"`
	Place string `json:"place,omitempty" jsonschema:"optional: a place's id or name, to read it and everything under it in full"`
}

func addWhatsKnown(t *toolbox) {
	tool(t, "whats_known", "What is known",
		"The world as this table knows it: the places (as a tree) and the people (the Folk) filed under them. Without a place you get the whole tree in brief; name a place to read it, and everything under it, in full.",
		func(ctx context.Context, in knownInput) (string, error) {
			tb, err := t.s.tableRef(ctx, in.Table)
			if err != nil {
				return "", err
			}
			id := tb.Campaign.Id
			places, ok, err := as[api.ListLocations200JSONResponse](t.s.ListLocations(ctx, api.ListLocationsRequestObject{CampaignId: id}))
			if err != nil {
				return "", err
			}
			if !ok {
				return "", notReadable("That table")
			}
			folk, _, err := as[api.ListNpcs200JSONResponse](t.s.ListNpcs(ctx, api.ListNpcsRequestObject{CampaignId: id}))
			if err != nil {
				return "", err
			}
			byPlace := map[uuid.UUID][]api.Npc{}
			var unfiled []api.Npc
			for _, n := range folk {
				if n.LocationId != nil && (n.Traveling == nil || !*n.Traveling) {
					byPlace[*n.LocationId] = append(byPlace[*n.LocationId], n)
				} else {
					unfiled = append(unfiled, n)
				}
			}

			full := false
			if ref := strings.TrimSpace(in.Place); ref != "" {
				root, err := pickOne(places, ref, "place", func(l api.Location) uuid.UUID { return l.Id }, func(l api.Location) string { return l.Name })
				if err != nil {
					return "", err
				}
				places = subtree(places, root.Id)
				full = true
			}

			var b strings.Builder
			fmt.Fprintf(&b, "# What %s knows\n\n", tb.Campaign.Name)
			if len(places) == 0 {
				b.WriteString("_No places charted yet._\n")
			}
			base := 0
			if len(places) > 0 {
				base = places[0].Depth
			}
			for _, l := range places {
				indent := strings.Repeat("  ", max(l.Depth-base, 0))
				fmt.Fprintf(&b, "%s- **%s** (`%s`)", indent, l.Name, l.Id)
				if mark := hiddenMark(l.VisibleToParty); mark != "" {
					b.WriteString(mark)
				} else if l.HiddenByAncestor != nil && *l.HiddenByAncestor {
					b.WriteString(" _(hidden: a place above it is)_")
				}
				if full {
					if d := strings.TrimSpace(l.Description); d != "" {
						fmt.Fprintf(&b, "\n%s  %s", indent, strings.ReplaceAll(d, "\n", "\n"+indent+"  "))
					}
				} else if d := firstLine(l.Description, 140); d != "" {
					fmt.Fprintf(&b, " — %s", d)
				}
				b.WriteString("\n")
				for _, n := range byPlace[l.Id] {
					writeNpc(&b, indent+"  ", n, full)
				}
			}
			if !full && len(unfiled) > 0 {
				b.WriteString("\n## People with no place, or on the road\n\n")
				for _, n := range unfiled {
					writeNpc(&b, "", n, false)
				}
			}
			return b.String(), nil
		})
}

// subtree keeps a place and everything under it, in the list's own order.
func subtree(places []api.Location, root uuid.UUID) []api.Location {
	in := map[uuid.UUID]bool{root: true}
	var out []api.Location
	// The handler lists a parent before its children, so one pass suffices.
	for _, l := range places {
		if l.Id == root || (l.ParentId != nil && in[*l.ParentId]) {
			in[l.Id] = true
			out = append(out, l)
		}
	}
	return out
}

func writeNpc(b *strings.Builder, indent string, n api.Npc, full bool) {
	fmt.Fprintf(b, "%s- 👤 **%s** (`%s`)%s", indent, n.Name, n.Id, hiddenMark(n.VisibleToParty))
	if n.Traveling != nil && *n.Traveling {
		b.WriteString(" · traveling with the party")
	}
	if n.StatBlock != nil {
		fmt.Fprintf(b, " · stats: %s", n.StatBlock.Name)
	}
	if full {
		if d := strings.TrimSpace(n.Description); d != "" {
			fmt.Fprintf(b, "\n%s  %s", indent, strings.ReplaceAll(d, "\n", "\n"+indent+"  "))
		}
	} else if d := firstLine(n.Description, 120); d != "" {
		fmt.Fprintf(b, " — %s", d)
	}
	b.WriteString("\n")
}

// --- party ----------------------------------------------------------------

func addParty(t *toolbox) {
	tool(t, "party", "Party",
		"Who is at a table: the DMs, the heroes (class, level, HP, party) and the allies traveling with them.",
		func(ctx context.Context, in tableInput) (string, error) {
			tb, err := t.s.tableRef(ctx, in.Table)
			if err != nil {
				return "", err
			}
			id := tb.Campaign.Id
			members, ok, err := as[api.ListMembers200JSONResponse](t.s.ListMembers(ctx, api.ListMembersRequestObject{CampaignId: id}))
			if err != nil {
				return "", err
			}
			if !ok {
				return "", notReadable("That table")
			}
			heroes, _, err := as[api.ListCharacters200JSONResponse](t.s.ListCharacters(ctx, api.ListCharactersRequestObject{CampaignId: id}))
			if err != nil {
				return "", err
			}
			folk, _, err := as[api.ListNpcs200JSONResponse](t.s.ListNpcs(ctx, api.ListNpcsRequestObject{CampaignId: id}))
			if err != nil {
				return "", err
			}
			var b strings.Builder
			fmt.Fprintf(&b, "# At %s\n\n", tb.Campaign.Name)
			dms := []string{}
			for _, m := range members {
				if m.Role == api.Dm {
					n := m.Name
					if m.IsOwner {
						n += " (owner)"
					}
					dms = append(dms, n)
				}
			}
			fmt.Fprintf(&b, "Run by %s.\n\n## Heroes\n\n", strings.Join(dms, ", "))
			if len(heroes) == 0 {
				b.WriteString("_Nobody seated yet._\n")
			}
			for _, c := range heroes {
				fmt.Fprintf(&b, "- **%s** (`%s`) — %s · HP %d/%d · played by %s", c.Name, c.Id, heroClassLine(c), c.HpCurrent, c.HpMax, c.OwnerName)
				if c.PartyName != nil {
					fmt.Fprintf(&b, " · rides with %s", *c.PartyName)
				}
				b.WriteString("\n")
			}
			allies := []api.Npc{}
			for _, n := range folk {
				if n.Traveling != nil && *n.Traveling {
					allies = append(allies, n)
				}
			}
			if len(allies) > 0 {
				b.WriteString("\n## Traveling with them\n\n")
				for _, n := range allies {
					fmt.Fprintf(&b, "- **%s** (`%s`)", n.Name, n.Id)
					if n.HpMax != nil && n.HpCurrent != nil {
						fmt.Fprintf(&b, " · HP %d/%d", *n.HpCurrent, *n.HpMax)
					}
					if n.ControlUserName != nil {
						fmt.Fprintf(&b, " · run by %s", *n.ControlUserName)
					}
					if n.PartyName != nil {
						fmt.Fprintf(&b, " · with %s", *n.PartyName)
					}
					b.WriteString("\n")
				}
			}
			return b.String(), nil
		})
}

// --- den_search -----------------------------------------------------------

type denInput struct {
	Text  string   `json:"text,omitempty" jsonschema:"optional: words in the name or the stat block"`
	Type  string   `json:"type,omitempty" jsonschema:"optional: creature type, e.g. Undead, Beast, Fiend"`
	CRMin *float64 `json:"cr_min,omitempty" jsonschema:"optional: lowest challenge rating (0.25 for 1/4)"`
	CRMax *float64 `json:"cr_max,omitempty" jsonschema:"optional: highest challenge rating"`
	Limit int      `json:"limit,omitempty" jsonschema:"how many to list (default 25, at most 100)"`
}

type monsterFacts struct {
	Size    string   `json:"size"`
	Type    string   `json:"type"`
	CR      string   `json:"cr"`
	CRValue *float64 `json:"crValue"`
	AC      any      `json:"ac"`
	HP      any      `json:"hp"`
	Desc    string   `json:"description"`
}

func factsOf(m api.RulesContent) monsterFacts {
	var f monsterFacts
	if raw, err := json.Marshal(m.Data); err == nil {
		_ = json.Unmarshal(raw, &f)
	}
	return f
}

func crLabel(v *float64) string {
	if v == nil {
		return "?"
	}
	switch *v {
	case 0.125:
		return "1/8"
	case 0.25:
		return "1/4"
	case 0.5:
		return "1/2"
	}
	return fmt.Sprint(*v)
}

// den is the Monster Den as the caller may read it: empty unless they run a
// table, which is the handler's own rule.
func (s *Server) den(ctx context.Context) ([]api.RulesContent, error) {
	list, ok, err := as[api.ListRules200JSONResponse](s.ListRules(ctx, api.ListRulesRequestObject{Kind: api.ContentKindMonster}))
	if err != nil {
		return nil, err
	}
	if !ok || len(list) == 0 {
		return nil, refuse("The Monster Den is for DMs; you run no table this token can reach.")
	}
	return list, nil
}

func addDenSearch(t *toolbox) {
	tool(t, "den_search", "Search the Monster Den",
		"DM only. Find monsters in the Den — the SRD and your homebrew — by words, creature type and challenge rating. Use lookup with kind monster for a full stat block.",
		func(ctx context.Context, in denInput) (string, error) {
			den, err := t.s.den(ctx)
			if err != nil {
				return "", err
			}
			limit := in.Limit
			if limit <= 0 {
				limit = 25
			}
			limit = min(limit, 100)
			text := strings.ToLower(strings.TrimSpace(in.Text))
			typ := strings.ToLower(strings.TrimSpace(in.Type))
			var hits []api.RulesContent
			for _, m := range den {
				f := factsOf(m)
				if typ != "" && !strings.Contains(strings.ToLower(f.Type), typ) {
					continue
				}
				if in.CRMin != nil && (f.CRValue == nil || *f.CRValue < *in.CRMin) {
					continue
				}
				if in.CRMax != nil && (f.CRValue == nil || *f.CRValue > *in.CRMax) {
					continue
				}
				if text != "" && !strings.Contains(strings.ToLower(m.Name), text) && !strings.Contains(strings.ToLower(f.Desc), text) {
					continue
				}
				hits = append(hits, m)
			}
			sort.SliceStable(hits, func(i, j int) bool {
				a, b := factsOf(hits[i]).CRValue, factsOf(hits[j]).CRValue
				if a == nil || b == nil {
					return b != nil
				}
				return *a < *b
			})
			if len(hits) == 0 {
				return "Nothing in the Den matches that.", nil
			}
			var b strings.Builder
			fmt.Fprintf(&b, "# The Den: %d match", len(hits))
			if len(hits) != 1 {
				b.WriteString("es")
			}
			if len(hits) > limit {
				fmt.Fprintf(&b, " (showing %d)", limit)
				hits = hits[:limit]
			}
			b.WriteString("\n\n")
			for _, m := range hits {
				f := factsOf(m)
				fmt.Fprintf(&b, "- **%s** — %s %s, CR %s (%d XP), AC %v, HP %v", m.Name, f.Size, f.Type, crLabel(f.CRValue), rules.MonsterXP(mustJSON(m.Data)), f.AC, f.HP)
				if m.Mine {
					b.WriteString(" · your homebrew")
				}
				b.WriteString("\n")
			}
			return b.String(), nil
		})
}

func mustJSON(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

// --- encounter_check ------------------------------------------------------

type foeInput struct {
	Name  string `json:"name" jsonschema:"a monster's name in the Den"`
	Count int    `json:"count,omitempty" jsonschema:"how many (default 1)"`
}

type encounterInput struct {
	Table    string     `json:"table,omitempty" jsonschema:"the table's id or name; may be left out when you sit at only one"`
	Monsters []foeInput `json:"monsters" jsonschema:"the foes in the fight"`
	Party    string     `json:"party,omitempty" jsonschema:"optional: only the heroes riding with this party"`
	Levels   []int      `json:"levels,omitempty" jsonschema:"optional: the heroes' levels, instead of reading the table's roster"`
}

func addEncounterCheck(t *toolbox) {
	tool(t, "encounter_check", "Check an encounter",
		"DM only. How hard a proposed fight is for this table's party, by the 2024 rules the encounter builder uses: total XP against the party's low / moderate / high budgets.",
		func(ctx context.Context, in encounterInput) (string, error) {
			tb, err := t.s.tableRef(ctx, in.Table)
			if err != nil {
				return "", err
			}
			if _, err := t.s.requireDM(ctx, tb.Campaign.Id); err != nil {
				return "", refuse("Only the table's DMs can check its encounters.")
			}
			if len(in.Monsters) == 0 {
				return "", refuse("Name at least one monster.")
			}
			den, err := t.s.den(ctx)
			if err != nil {
				return "", err
			}

			levels := in.Levels
			who := "the levels given"
			if len(levels) == 0 {
				heroes, _, err := as[api.ListCharacters200JSONResponse](t.s.ListCharacters(ctx, api.ListCharactersRequestObject{CampaignId: tb.Campaign.Id}))
				if err != nil {
					return "", err
				}
				names := []string{}
				for _, c := range heroes {
					if in.Party != "" && (c.PartyName == nil || !strings.EqualFold(*c.PartyName, in.Party)) {
						continue
					}
					levels = append(levels, c.Level)
					names = append(names, fmt.Sprintf("%s (%d)", c.Name, c.Level))
				}
				if len(levels) == 0 {
					return "", refuse("No heroes to measure against at %s; pass levels instead.", tb.Campaign.Name)
				}
				who = strings.Join(names, ", ")
			}

			var b strings.Builder
			total := 0
			b.WriteString("# Encounter check\n\n")
			for _, foe := range in.Monsters {
				m, err := pickOne(den, strings.TrimSpace(foe.Name), "monster", func(r api.RulesContent) uuid.UUID { return r.Id }, func(r api.RulesContent) string { return r.Name })
				if err != nil {
					return "", err
				}
				n := max(foe.Count, 1)
				xp := rules.MonsterXP(mustJSON(m.Data))
				total += xp * n
				fmt.Fprintf(&b, "- %d × %s (CR %s) = %d XP\n", n, m.Name, crLabel(factsOf(m).CRValue), xp*n)
			}
			budget := rules.PartyBudget(levels)
			band := rules.BandFor(total, budget)
			fmt.Fprintf(&b, "\n**Total %d XP → %s** against %s.\n\nBudgets: low %d · moderate %d · high %d.\n",
				total, band, who, budget.Low, budget.Moderate, budget.High)
			return b.String(), nil
		})
}
