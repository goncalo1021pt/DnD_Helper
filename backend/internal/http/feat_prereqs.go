package http

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

/*
A feat's prerequisite, read (#384).

Invocations name theirs in prose — "Level 5+ Warlock, Pact of the Blade
Invocation" — and until they were a class feature's choice nothing needed to
read it, because nothing offered them anywhere a level could be checked. The
prose has two shapes worth enforcing and a long tail that is not:

  - "Level N+ <Class>" is the level in that class; "Level N+" alone is the
    hero's total, the way a general feat says it.
  - "<Name> Invocation" is another invocation the hero must hold — or be
    taking in the same breath, since a Warlock 5 may pick Pact of the Blade and
    Thirsting Blade together.

Anything else ("a Warlock Cantrip That Deals Damage", "Fighting Style
Feature") is shown to the player and not judged: a reading that guesses wrong
refuses a legal hero, and the table can rule on a cantrip.

Mirrored by prereqUnmet in frontend/src/lib/featureChoices.ts and held to it by
fixtures/rules/feat-prerequisites.json.
*/

type featPrereq struct {
	Class string // empty means the hero's total level
	Level int
	Feats []string
}

var (
	prereqLevel = regexp.MustCompile(`(?i)^level\s+(\d+)\+(?:\s+(.+))?$`)
	prereqFeat  = regexp.MustCompile(`(?i)^(.+?)\s+invocation$`)
)

func parseFeatPrereq(text string) featPrereq {
	var p featPrereq
	for _, part := range strings.Split(text, ",") {
		part = strings.TrimSpace(part)
		if m := prereqLevel.FindStringSubmatch(part); m != nil {
			p.Level, _ = strconv.Atoi(m[1])
			p.Class = strings.TrimSpace(m[2])
			continue
		}
		if m := prereqFeat.FindStringSubmatch(part); m != nil {
			p.Feats = append(p.Feats, strings.TrimSpace(m[1]))
		}
	}
	return p
}

// unmet says what the hero still lacks, or "" when the readable part holds.
// `levels` are the hero's levels by lowercased class name.
func (p featPrereq) unmet(levels map[string]int, total int, has func(string) bool) string {
	if p.Level > 0 {
		at := total
		if p.Class != "" {
			at = levels[strings.ToLower(p.Class)]
		}
		if at < p.Level {
			if p.Class != "" {
				return fmt.Sprintf("needs %s level %d", p.Class, p.Level)
			}
			return fmt.Sprintf("needs level %d", p.Level)
		}
	}
	for _, f := range p.Feats {
		if !has(f) {
			return "needs " + f
		}
	}
	return ""
}
