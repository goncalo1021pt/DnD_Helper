package rules

import "sort"

/*
Hit dice, pooled by die type (PHB 2024, p.44).

	"Add together the Hit Dice granted by all your classes to form your pool of
	Hit Dice. If these dice are the same die type, you can pool them together
	… If your classes give you Hit Dice of different types, track them
	separately."

So a level 5 Fighter / level 5 Paladin has ten d10, and a level 5 Cleric /
level 5 Paladin has five d8 and five d10 — the same total, spent differently.
Only what has been spent is stored; the maximum is this, recomputed.
*/

// ClassDie is one class's contribution: how big its die is and how many levels
// the hero holds in it.
type ClassDie struct {
	Die    int
	Levels int
}

// HitDicePool is one die size and how the hero stands with it.
type HitDicePool struct {
	Die  int `json:"die"`
	Max  int `json:"max"`
	Used int `json:"used"`
}

// DefaultHitDie is what a hero with no class content rolls. Quick-add heroes
// are a name, a level and a freeform class line; the short rest has always
// given them a d8 and this keeps that true.
const DefaultHitDie = 8

/*
HitDicePools resolves a hero's dice.

`spent` is keyed by die size, as stored. `fallbackLevel` builds the pool for a
hero with no classes at all, so a quick-add hero still has dice to spend.

Dice that were spent but are no longer granted still appear while any remain
spent: a hero who somehow loses a class should not have those dice quietly
vanish from a rest report mid-session. They show a max of zero and a used
count, which reads as the anomaly it is rather than hiding it.
*/
func HitDicePools(classes []ClassDie, fallbackLevel int, spent map[int]int) []HitDicePool {
	max := map[int]int{}
	for _, c := range classes {
		die := c.Die
		if die < 1 {
			die = DefaultHitDie
		}
		if c.Levels > 0 {
			max[die] += c.Levels
		}
	}
	if len(max) == 0 && fallbackLevel > 0 {
		max[DefaultHitDie] = fallbackLevel
	}
	for die, used := range spent {
		if used > 0 {
			if _, ok := max[die]; !ok {
				max[die] = 0
			}
		}
	}

	out := make([]HitDicePool, 0, len(max))
	for die, m := range max {
		used := spent[die]
		if used < 0 {
			used = 0
		}
		if used > m {
			used = m
		}
		out = append(out, HitDicePool{Die: die, Max: m, Used: used})
	}
	// Largest die first: it is the one a player reaches for, and a stable order
	// keeps the sheet from reshuffling between reads.
	sort.Slice(out, func(i, j int) bool { return out[i].Die > out[j].Die })
	return out
}

// SpendHitDice takes what the request asked for, clamped to what is actually
// left of each die. Returns the new spent map and what was really spent.
func SpendHitDice(pools []HitDicePool, want map[int]int) (spent map[int]int, taken map[int]int) {
	spent = map[int]int{}
	taken = map[int]int{}
	for _, p := range pools {
		n := want[p.Die]
		if n < 0 {
			n = 0
		}
		if available := p.Max - p.Used; n > available {
			n = available
		}
		if n > 0 {
			taken[p.Die] = n
		}
		if total := p.Used + n; total > 0 {
			spent[p.Die] = total
		}
	}
	return spent, taken
}

/*
RegainHitDice gives back every spent die on a long rest — PHB 2024: "you
regain all lost Hit Points and all spent Hit Point Dice." 2014's rule was
half the hero's total, and it lived here until #244.
*/
func RegainHitDice(pools []HitDicePool) (spent map[int]int, regained int) {
	spent = map[int]int{}
	for _, p := range pools {
		regained += p.Used
	}
	return spent, regained
}

// TotalHitDiceLeft is what the sheet shows beside the rest button.
func TotalHitDiceLeft(pools []HitDicePool) int {
	left := 0
	for _, p := range pools {
		if n := p.Max - p.Used; n > 0 {
			left += n
		}
	}
	return left
}
