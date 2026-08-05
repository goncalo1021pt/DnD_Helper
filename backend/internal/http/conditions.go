package http

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
What a combatant can be suffering (#173).

The 2024 rules fix fourteen conditions and one that counts to six, and this app
adds the state every table tracks alongside them without it being a condition at
all: concentration. That is the whole vocabulary. It is closed, so the server
holds the list and refuses anything else — a tracker whose chips are free text
becomes five spellings of "poisoned" by the third session, and nothing can ever
be counted or filtered afterwards.

Its twin is frontend/src/lib/conditions.ts, which offers the same list in the
DM's picker so the client never has to ask before it can draw. Both engines
answer fixtures/rules/conditions.json (#112) — neither side can move alone.

Exhaustion is the awkward one: it is a single condition with six levels, and a
DM tracks the level. Rather than a second column that only one condition would
ever use, a level rides in the name — "Exhaustion 3" — and normalisation keeps
at most one of them on a combatant, because a hero is not exhausted twice.
*/

// conditionNames is the canonical spelling of every condition, in the order the
// DM's picker shows them: the rules' own alphabetical list, with Concentrating
// first because it is the one toggled most and the only one that is not a
// condition in the rules' sense.
var conditionNames = []string{
	"Concentrating",
	"Blinded",
	"Charmed",
	"Deafened",
	"Frightened",
	"Grappled",
	"Incapacitated",
	"Invisible",
	"Paralyzed",
	"Petrified",
	"Poisoned",
	"Prone",
	"Restrained",
	"Stunned",
	"Unconscious",
}

// maxExhaustion is the level at which a hero dies, and so the highest one the
// tracker can hold.
const maxExhaustion = 6

// canonicalCondition resolves one written condition to its canonical spelling,
// or reports that there is no such thing.
//
// Case and surrounding space are forgiven — the name arrives from a JSON body
// that a script may have written as easily as our own picker — but a misspelling
// is not, because silently keeping "Poisened" is how the vocabulary rots.
func canonicalCondition(raw string) (string, bool) {
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" {
		return "", false
	}
	for _, c := range conditionNames {
		if strings.EqualFold(name, c) {
			return c, true
		}
	}
	// Exhaustion carries its level: "exhaustion 3" → "Exhaustion 3".
	if rest, ok := cutPrefixFold(name, "Exhaustion"); ok {
		lvl, err := strconv.Atoi(strings.TrimSpace(rest))
		if err != nil || lvl < 1 || lvl > maxExhaustion {
			return "", false
		}
		return fmt.Sprintf("Exhaustion %d", lvl), true
	}
	return "", false
}

// cutPrefixFold is strings.CutPrefix, case-insensitively.
func cutPrefixFold(s, prefix string) (rest string, ok bool) {
	if len(s) < len(prefix) || !strings.EqualFold(s[:len(prefix)], prefix) {
		return "", false
	}
	return s[len(prefix):], true
}

// normalizeConditions canonicalises a submitted set: every name resolved to its
// one spelling, duplicates dropped, and the result ordered so two DMs toggling
// the same three conditions in different orders store the same row.
//
// Exhaustion collapses to its highest level. A request carrying both
// "Exhaustion 1" and "Exhaustion 4" is not an error — it is a client that
// toggled one without clearing the other — and the worse of the two is the
// truthful reading.
func normalizeConditions(raw []string) ([]string, string) {
	order := make(map[string]int, len(conditionNames))
	for i, c := range conditionNames {
		order[c] = i
	}
	seen := make(map[string]bool, len(raw))
	exhaustion := 0
	var out []string
	for _, r := range raw {
		name, ok := canonicalCondition(r)
		if !ok {
			return nil, fmt.Sprintf("%q is not a condition", strings.TrimSpace(r))
		}
		if lvl, isExhaustion := cutPrefixFold(name, "Exhaustion "); isExhaustion {
			n, _ := strconv.Atoi(lvl)
			if n > exhaustion {
				exhaustion = n
			}
			continue
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	sort.Slice(out, func(i, j int) bool { return order[out[i]] < order[out[j]] })
	// Exhaustion sorts last wherever it appears: it is the one that is measured
	// rather than merely present, and the DM reads it as a number.
	if exhaustion > 0 {
		out = append(out, fmt.Sprintf("Exhaustion %d", exhaustion))
	}
	if out == nil {
		// An empty set is a real answer ("nothing ails this one"), and it must
		// reach Postgres as an empty array rather than a NULL.
		out = []string{}
	}
	return out, ""
}

// combatantConditions reads the conditions off a PATCH body, or reports why the
// request cannot stand. nil means the body did not mention them at all, which
// is not the same as clearing them — an omitted field leaves the row alone,
// an empty array wipes it.
func combatantConditions(b *api.UpdateCombatantRequest) (conditions []string, errMsg string) {
	if b.Conditions == nil {
		return nil, ""
	}
	return normalizeConditions(*b.Conditions)
}

// deathSaveTally is the pair as it will be written.
type deathSaveTally struct{ successes, failures int16 }

// maxDeathSaves is where a hero's fate is settled either way: three successes
// stabilise, three failures kill.
const maxDeathSaves = 3

// combatantDeathSaves reads the pips off a PATCH body and refuses the two ways
// the request can be meaningless.
//
// Pips on a monster are refused rather than ignored because the tracker does not
// give monsters death saves at all, so accepting the write would store a tally
// nothing ever shows. Pips on a hero who is not at 0 hit points are refused for
// the sharper reason: UpdateCombatant clears them on any write that raises HP,
// so a request setting both would silently contradict itself.
//
// hpAfter is the hit points the row will hold once this request lands, not the
// ones it holds now — a single PATCH may drop a hero to 0 and mark their first
// failed save, and that one has to work.
func combatantDeathSaves(b *api.UpdateCombatantRequest, row db.GetCombatantRow, hpAfter int32) (*deathSaveTally, string) {
	if b.DeathSaveSuccesses == nil && b.DeathSaveFailures == nil {
		return nil, ""
	}
	if row.Kind != "pc" {
		return nil, "only a player character rolls death saves"
	}
	if hpAfter > 0 {
		return nil, "death saves belong to a hero at 0 hit points"
	}
	// Whichever tally the request left out keeps its current value, so marking
	// a failure never quietly resets the successes beside it.
	out := deathSaveTally{successes: row.DeathSaveSuccesses, failures: row.DeathSaveFailures}
	if b.DeathSaveSuccesses != nil {
		if *b.DeathSaveSuccesses < 0 || *b.DeathSaveSuccesses > maxDeathSaves {
			return nil, fmt.Sprintf("death-save successes run 0 to %d", maxDeathSaves)
		}
		out.successes = int16(*b.DeathSaveSuccesses)
	}
	if b.DeathSaveFailures != nil {
		if *b.DeathSaveFailures < 0 || *b.DeathSaveFailures > maxDeathSaves {
			return nil, fmt.Sprintf("death-save failures run 0 to %d", maxDeathSaves)
		}
		out.failures = int16(*b.DeathSaveFailures)
	}
	return &out, ""
}
