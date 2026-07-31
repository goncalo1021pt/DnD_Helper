package http

import "fmt"

/*
The class features table: the columns a class's own prose keeps pointing at.

SRD feature text answers questions by referring elsewhere — "the number of
times shown in the Rages column of the Barbarian Features table", "as shown in
the Sneak Attack column" — and the app shipped the prose without the table it
cites, so a player at the table had to open the physical book to learn their own
Sneak Attack die (#129).

It lives on the content row's `data` rather than in Go for the same reason
`spellcasting` does: `internal/rules/spellslots.go` keeps *shared* game math in
code, while per-class variation stays in content. Content packs are additive, so
a homebrew class must be able to ship its own table, and it can only do that if
the table is data.

Every cell is the text the official table prints, "—" and "1d6" and "+10 ft."
included. That is deliberate: this is a table to read, not a resource pool to
spend. A machine-readable model of expendable uses — Rages spent, Focus Points
left — is a separate and much larger piece of work, and #118's rest mechanic is
what actually needs it. Printing the numbers is worth doing on its own: a player
who can read their Rage count off the sheet tracks uses on paper, as they
already do.
*/

// featuresTableLevels is the span every column must cover — a class's whole
// life, level 1 through 20, one value each.
const featuresTableLevels = 20

const maxFeaturesTableColumns = 8

// validateFeaturesTable checks the optional `featuresTable` on class data.
// Classes without one are perfectly valid — the Wizard has no column of its own
// in SRD 5.2, only spell counts the spellcasting data already carries.
func validateFeaturesTable(data map[string]interface{}) string {
	raw, present := data["featuresTable"]
	if !present || raw == nil {
		return ""
	}
	list, ok := raw.([]interface{})
	if !ok {
		return "featuresTable must be a list of columns"
	}
	if len(list) > maxFeaturesTableColumns {
		return fmt.Sprintf("a class features table can have at most %d columns", maxFeaturesTableColumns)
	}
	seen := map[string]bool{}
	for i, item := range list {
		col, ok := item.(map[string]interface{})
		if !ok {
			return fmt.Sprintf("featuresTable column %d must be an object {name, values}", i+1)
		}
		name, ok := getStr(col, "name")
		if !ok || name == "" {
			return fmt.Sprintf("featuresTable column %d needs a name (e.g. \"Sneak Attack\")", i+1)
		}
		if seen[name] {
			return "featuresTable has two columns called " + name
		}
		seen[name] = true
		values, ok := col["values"].([]interface{})
		if !ok {
			return name + " needs values: one entry per level"
		}
		// A short column is the failure that matters: the sheet indexes it by
		// the hero's level, and a table that stops at 12 is a blank box at 13.
		if len(values) != featuresTableLevels {
			return fmt.Sprintf("%s needs exactly %d values, one per level, got %d",
				name, featuresTableLevels, len(values))
		}
		for _, v := range values {
			switch v.(type) {
			case string, float64:
			default:
				return name + " values must be text or numbers"
			}
		}
	}
	return ""
}
