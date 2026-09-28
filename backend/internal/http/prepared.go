package http

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

/*
The spells a hero's classes keep always prepared (#361), derived on read.

Nothing is stored: the table lives on the class or subclass, the level is the
hero's level in that class, and the names resolve against the spells the
hero's owner may see. So a Fiend Warlock reaching 5 has Fireball the moment
the level lands, and a DM who fixes a typo in a homebrew oath fixes every
Paladin sworn to it.

A granted spell belongs to the class that grants it — it is cast off that
class's ability — and it is never a pick: it does not count against the
allowance, cannot be picked again, and cannot be swapped in.
*/

// grantedNames is the always-prepared table of one class and its subclass at
// a level in that class — the class's own rows first, then the subclass's.
func grantedNames(classData, subclassData []byte, level int) []string {
	names := rules.PreparedAt(rules.AlwaysPreparedIn(classData), level)
	seen := map[string]bool{}
	for _, n := range names {
		seen[strings.ToLower(n)] = true
	}
	for _, n := range rules.PreparedAt(rules.AlwaysPreparedIn(subclassData), level) {
		if !seen[strings.ToLower(n)] {
			seen[strings.ToLower(n)] = true
			names = append(names, n)
		}
	}
	return names
}

// spellsNamed resolves spell names against what the owner may see. The SRD
// wins a name it shares with homebrew, as it does for a creature grant, so a
// shadowing entry cannot quietly replace the spell a book meant. A name
// nobody knows grants nothing.
func (s *Server) spellsNamed(ctx context.Context, owner uuid.UUID, names []string) ([]db.RulesContent, error) {
	if len(names) == 0 {
		return nil, nil
	}
	rows, err := s.queries.ListContentByKind(ctx, db.ListContentByKindParams{
		Kind: db.ContentKindSpell, CreatedBy: pgUUID(owner),
	})
	if err != nil {
		return nil, err
	}
	byName := map[string]db.RulesContent{}
	for _, r := range rows {
		key := strings.ToLower(r.Name)
		if prior, seen := byName[key]; seen && prior.Source == db.ContentSourceSrd {
			continue
		}
		byName[key] = db.RulesContent{
			ID: r.ID, Kind: r.Kind, Source: r.Source, Name: r.Name,
			Summary: r.Summary, Data: r.Data, CreatedBy: r.CreatedBy,
		}
	}
	var out []db.RulesContent
	for _, n := range names {
		if row, ok := byName[strings.ToLower(n)]; ok {
			out = append(out, row)
		}
	}
	return out, nil
}

// grantedIDs is the set of spell ids a class and its subclass keep prepared
// at a level in that class — what the pick and swap validators refuse.
func (s *Server) grantedIDs(ctx context.Context, owner uuid.UUID, classData, subclassData []byte, level int) (map[uuid.UUID]bool, error) {
	rows, err := s.spellsNamed(ctx, owner, grantedNames(classData, subclassData, level))
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID]bool{}
	for _, r := range rows {
		out[r.ID] = true
	}
	return out, nil
}

// grantedByClass is every class's always-prepared spells for one hero, keyed
// by class id, read at the hero's level in each class.
func (s *Server) grantedByClass(ctx context.Context, owner uuid.UUID, classes []heroClass) (map[uuid.UUID][]db.RulesContent, error) {
	out := map[uuid.UUID][]db.RulesContent{}
	for _, k := range classes {
		names := grantedNames(k.ClassData, k.SubclassData, int(k.Level))
		if len(names) == 0 {
			continue
		}
		rows, err := s.spellsNamed(ctx, owner, names)
		if err != nil {
			return nil, err
		}
		if len(rows) > 0 {
			out[k.ClassID] = rows
		}
	}
	return out, nil
}

// withoutGranted drops the rows a class now keeps prepared of its own accord:
// a spell the player picked at level 2 and the patron grants at level 3 stops
// costing a pick the moment the grant lands.
func withoutGranted(rows []db.ListCharacterSpellsRow, granted map[uuid.UUID]bool) []db.ListCharacterSpellsRow {
	if len(granted) == 0 {
		return rows
	}
	out := make([]db.ListCharacterSpellsRow, 0, len(rows))
	for _, r := range rows {
		if !granted[r.ID] {
			out = append(out, r)
		}
	}
	return out
}
