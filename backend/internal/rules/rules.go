// Package rules seeds the rules_content table with the SRD 5.2 subset the
// character builder needs. Seeding is an idempotent upsert keyed on
// (kind, 'srd', name), so editing the JSON and restarting updates rows in
// place. See ATTRIBUTION.md for the CC-BY-4.0 notice.
package rules

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

//go:embed srd/*.json
var srdFiles embed.FS

type entry struct {
	Name    string          `json:"name"`
	Summary string          `json:"summary"`
	Data    json.RawMessage `json:"data"`
}

var kindFiles = map[db.ContentKind]string{
	db.ContentKindClass:      "srd/classes.json",
	db.ContentKindSpecies:    "srd/species.json",
	db.ContentKindBackground: "srd/backgrounds.json",
	db.ContentKindSubclass:   "srd/subclasses.json",
	db.ContentKindFeat:       "srd/feats.json",
	db.ContentKindSpell:      "srd/spells.json",
	db.ContentKindItem:       "srd/items.json",
	db.ContentKindMonster:    "srd/monsters.json",
}

// Seed upserts every embedded SRD entry. Safe to run on each startup.
func Seed(ctx context.Context, queries *db.Queries) error {
	for kind, file := range kindFiles {
		raw, err := srdFiles.ReadFile(file)
		if err != nil {
			return fmt.Errorf("rules seed: read %s: %w", file, err)
		}
		var entries []entry
		if err := json.Unmarshal(raw, &entries); err != nil {
			return fmt.Errorf("rules seed: parse %s: %w", file, err)
		}
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name)
			if _, err := queries.UpsertSRDContent(ctx, db.UpsertSRDContentParams{
				Kind:    kind,
				Name:    e.Name,
				Summary: e.Summary,
				Data:    e.Data,
			}); err != nil {
				return fmt.Errorf("rules seed: upsert %s %q: %w", kind, e.Name, err)
			}
		}
		// The seed is authoritative for SRD rows of this kind.
		if err := queries.PruneSRDContent(ctx, db.PruneSRDContentParams{
			Kind:    kind,
			Column2: names,
		}); err != nil {
			return fmt.Errorf("rules seed: prune %s: %w", kind, err)
		}
	}
	return nil
}
