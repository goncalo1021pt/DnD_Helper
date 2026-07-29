package http

import (
	"fmt"
	"sort"
	"strings"
)

/*
Species choices: the picks a species asks for at character creation — an Elf's
lineage, a Gnome's Forest-or-Rock, a Human's free skill and Origin feat.

Species data carries them as a `choices` array so the Forge can render a real
picker instead of burying the options in one trait's prose, and so the picks
land on the sheet. A choice's `type` is what decides whether it means anything
mechanically: skill picks join the character's proficiencies, feat picks join
its feats, and the rest are recorded for display.
*/

type speciesTrait struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
	// Choice links the trait to the choices entry it asks the player to make.
	Choice string `json:"choice,omitempty"`
}

type speciesChoiceOption struct {
	Name    string `json:"name"`
	Summary string `json:"summary,omitempty"`
}

type speciesChoice struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Choose  int    `json:"choose"`
	Summary string `json:"summary,omitempty"`
	// From opens the pick beyond an explicit option list: "*" for any skill or
	// tool, "origin" for any Origin feat.
	From    string                `json:"from,omitempty"`
	Options []speciesChoiceOption `json:"options,omitempty"`
}

// The species-data slice the forge and the content validator need.
type speciesRules struct {
	Size    string          `json:"size"`
	Speed   int             `json:"speed"`
	Traits  []speciesTrait  `json:"traits"`
	Choices []speciesChoice `json:"choices"`
}

// What a choice's type means for the sheet. Types outside this set are
// rejected so a typo ("skills") never silently becomes a display-only pick.
var speciesChoiceTypes = map[string]bool{
	"lineage": true, // a named bundle of traits — Drow, Rock Gnome, Stone's Endurance
	"skill":   true, // grants skill proficiency; lands in characters.skills
	"tool":    true, // grants tool proficiency; recorded only (no sheet column)
	"feat":    true, // grants a feat; lands in characters.feats
	"size":    true, // picks between the sizes the species offers
	"ability": true, // picks the spellcasting ability a lineage's spells use
}

const maxSpeciesChoices = 8

// validateSpeciesChoices checks the optional `choices` array on species data.
// Species without one are perfectly valid — most have no picks to make.
func validateSpeciesChoices(data map[string]interface{}) string {
	raw, present := data["choices"]
	if !present || raw == nil {
		return ""
	}
	list, ok := raw.([]interface{})
	if !ok {
		return "species choices must be a list"
	}
	if len(list) > maxSpeciesChoices {
		return fmt.Sprintf("a species can ask for at most %d choices", maxSpeciesChoices)
	}
	seenID := map[string]bool{}
	for i, item := range list {
		c, ok := item.(map[string]interface{})
		if !ok {
			return fmt.Sprintf("choice %d must be an object", i+1)
		}
		id, _ := getStr(c, "id")
		id = strings.TrimSpace(id)
		if id == "" || len(id) > 40 {
			return fmt.Sprintf("choice %d needs an id of 1-40 characters", i+1)
		}
		if seenID[id] {
			return "duplicate choice id: " + id
		}
		seenID[id] = true

		if name, _ := getStr(c, "name"); strings.TrimSpace(name) == "" {
			return "choice " + id + " needs a name"
		}
		kind, _ := getStr(c, "type")
		if !speciesChoiceTypes[kind] {
			return "choice " + id + " needs a type of " + speciesChoiceTypeList()
		}
		choose := 1
		if n, ok := getNum(c, "choose"); ok {
			choose = int(n)
		}
		if choose < 1 || choose > 4 {
			return "choice " + id + " must choose between 1 and 4 options"
		}

		from, _ := getStr(c, "from")
		options, msg := parseChoiceOptions(c, id)
		if msg != "" {
			return msg
		}
		if len(options) == 0 {
			// An open pick is only meaningful for the kinds that have a pool
			// to draw from.
			switch {
			case kind == "skill" && from == "*":
			case kind == "tool" && from == "*":
			case kind == "feat" && (from == "origin" || from == "*"):
			default:
				return "choice " + id + " needs options, or from: \"*\" (skill/tool) or \"origin\" (feat)"
			}
		} else {
			if choose > len(options) {
				return fmt.Sprintf("choice %s asks for %d of only %d options", id, choose, len(options))
			}
			if kind == "skill" {
				for _, opt := range options {
					if !allSkills[opt.Name] {
						return "choice " + id + " lists an unknown skill: " + opt.Name
					}
				}
			}
		}
	}
	return ""
}

func parseChoiceOptions(c map[string]interface{}, id string) ([]speciesChoiceOption, string) {
	raw, present := c["options"]
	if !present || raw == nil {
		return nil, ""
	}
	list, ok := raw.([]interface{})
	if !ok {
		return nil, "choice " + id + " options must be a list"
	}
	out := make([]speciesChoiceOption, 0, len(list))
	seen := map[string]bool{}
	for _, item := range list {
		o, ok := item.(map[string]interface{})
		if !ok {
			return nil, "choice " + id + " options must be objects"
		}
		name, _ := getStr(o, "name")
		name = strings.TrimSpace(name)
		if name == "" || len([]rune(name)) > 80 {
			return nil, "choice " + id + " has an option without a name"
		}
		if seen[name] {
			return nil, "choice " + id + " repeats the option " + name
		}
		seen[name] = true
		summary, _ := getStr(o, "summary")
		out = append(out, speciesChoiceOption{Name: name, Summary: summary})
	}
	return out, ""
}

func speciesChoiceTypeList() string {
	types := make([]string, 0, len(speciesChoiceTypes))
	for t := range speciesChoiceTypes {
		types = append(types, t)
	}
	sort.Strings(types)
	return strings.Join(types, ", ")
}

// speciesPicks is the resolved result of a player's species choices: the map
// to store on the character plus what those picks grant the sheet.
type speciesPicks struct {
	Stored map[string][]string
	Skills []string
	Feats  []string
}

// resolveSpeciesChoices matches a player's picks against what the species
// actually offers. `takenSkills` are the proficiencies already granted by the
// background and class, so a species pick can't double up on one.
//
// Every choice must be answered exactly — a missing lineage is as much an
// error as an unknown one, since a half-built species is not a legal hero.
func resolveSpeciesChoices(sp speciesRules, speciesName string, picks map[string][]string, takenSkills map[string]bool) (speciesPicks, string) {
	out := speciesPicks{Stored: map[string][]string{}}

	offered := map[string]bool{}
	for _, c := range sp.Choices {
		offered[c.ID] = true
	}
	for id := range picks {
		if !offered[id] {
			return out, speciesName + " has no choice called " + id
		}
	}

	granted := map[string]bool{}
	for sk := range takenSkills {
		granted[sk] = true
	}

	for _, c := range sp.Choices {
		choose := c.Choose
		if choose < 1 {
			choose = 1
		}
		picked := picks[c.ID]
		if len(picked) != choose {
			return out, fmt.Sprintf("%s: choose %d for %s", speciesName, choose, c.Name)
		}

		allowed := map[string]bool{}
		for _, opt := range c.Options {
			allowed[opt.Name] = true
		}
		seen := map[string]bool{}
		for _, p := range picked {
			p = strings.TrimSpace(p)
			if p == "" {
				return out, c.Name + " needs a choice"
			}
			if seen[p] {
				return out, c.Name + ": duplicate choice " + p
			}
			seen[p] = true

			if len(allowed) > 0 && !allowed[p] {
				return out, fmt.Sprintf("%s is not an option for %s", p, c.Name)
			}
			switch c.Type {
			case "skill":
				if !allSkills[p] {
					return out, "unknown skill: " + p
				}
				if granted[p] {
					return out, p + " is already granted elsewhere on this hero — choose another for " + c.Name
				}
				granted[p] = true
				out.Skills = append(out.Skills, p)
			case "feat":
				out.Feats = append(out.Feats, p)
			}
			out.Stored[c.ID] = append(out.Stored[c.ID], p)
		}
	}
	return out, ""
}
