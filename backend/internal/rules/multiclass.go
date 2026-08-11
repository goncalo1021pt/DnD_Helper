package rules

import (
	"fmt"
	"sort"
	"strings"
)

/*
Qualifying for a new class (PHB 2024, p.44).

	"To qualify for a new class, you must have a score of at least 13 in the
	primary ability of the new class and your current classes."

Both directions: the Barbarian multiclassing into Druid needs Strength 13 for
what they already are and Wisdom 13 for what they are becoming.

The wrinkle is that "the primary ability" is not always one ability, and the
book does not mean the same thing each time it is two. Fighter reads "Strength
**or** Dexterity" — either will do. Paladin reads "Strength **and** Charisma",
Monk and Ranger "Dexterity and Wisdom" — both are needed. So a class's
primaryAbility list alone cannot answer the question, and content says which
it means: `data.multiclass.prerequisite.any` for the Fighter's reading, and
otherwise every ability in the list.

Defaulting to "all" is the safe way round. A homebrew class that declares
nothing gets the stricter reading, which refuses a hero at the door rather
than letting them through and finding out later.
*/

// MulticlassPrereq is what a class asks of a hero before it will take them.
type MulticlassPrereq struct {
	// Any of these at 13+ satisfies it (the Fighter's "Strength or Dexterity").
	Any []string `json:"any"`
	// All of these at 13+ are required. Defaults to the class's primaryAbility.
	All []string `json:"all"`
}

// MulticlassData is the optional `multiclass` block on a class entry.
type MulticlassData struct {
	Prerequisite *MulticlassPrereq `json:"prerequisite"`
	// What a hero gains from this class when it is not their first — display
	// only today, and the wording comes straight from the class's "As a
	// Multiclass Character" list.
	Proficiencies []string `json:"proficiencies"`
}

// MinPrimaryScore is the 13 in "a score of at least 13".
const MinPrimaryScore = 13

// abilityKeys normalises "STR"/"str"/"Strength" to the three-letter key the
// character row uses.
func abilityKey(s string) string {
	t := strings.ToLower(strings.TrimSpace(s))
	if len(t) >= 3 {
		t = t[:3]
	}
	switch t {
	case "str", "dex", "con", "int", "wis", "cha":
		return t
	}
	return ""
}

var abilityWord = map[string]string{
	"str": "Strength", "dex": "Dexterity", "con": "Constitution",
	"int": "Intelligence", "wis": "Wisdom", "cha": "Charisma",
}

/*
MeetsPrereq reports whether these ability scores qualify for a class, and says
what is missing when they do not.

`primary` is the class's primaryAbility; `mc` its declared multiclass block,
which may be nil. Scores are keyed str…cha.
*/
func MeetsPrereq(primary []string, mc *MulticlassData, scores map[string]int) (bool, string) {
	var any, all []string
	if mc != nil && mc.Prerequisite != nil {
		any = mc.Prerequisite.Any
		all = mc.Prerequisite.All
	}
	if len(any) == 0 && len(all) == 0 {
		all = primary
	}

	if len(any) > 0 {
		for _, a := range any {
			if k := abilityKey(a); k != "" && scores[k] >= MinPrimaryScore {
				return true, ""
			}
		}
		return false, needs(any, "or")
	}

	var missing []string
	for _, a := range all {
		k := abilityKey(a)
		if k == "" {
			continue
		}
		if scores[k] < MinPrimaryScore {
			missing = append(missing, k)
		}
	}
	if len(missing) == 0 {
		return true, ""
	}
	return false, needs(missing, "and")
}

// needs renders "Strength 13" / "Strength 13 and Charisma 13" / "… or …".
func needs(keys []string, joiner string) string {
	words := make([]string, 0, len(keys))
	seen := map[string]bool{}
	for _, k := range keys {
		key := abilityKey(k)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		words = append(words, fmt.Sprintf("%s %d", abilityWord[key], MinPrimaryScore))
	}
	sort.Strings(words)
	switch len(words) {
	case 0:
		return ""
	case 1:
		return words[0]
	default:
		return strings.Join(words[:len(words)-1], ", ") + " " + joiner + " " + words[len(words)-1]
	}
}
