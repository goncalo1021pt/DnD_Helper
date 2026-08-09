package http

import (
	"fmt"
	"math/rand/v2"
	"sort"
	"strings"
)

/*
The dice pool, server side (#176).

A pool is die groups plus one flat modifier — "1d4 + 2d8 + 3" — composed in
the browser and rolled here whenever the roll is made in the open. The server
rolls it rather than accepting a number, because a shared log that takes the
roller's word for the result is not a record of anything.

Mirrors frontend/src/lib/dice.ts, held to it by fixtures/rules/dice-pool.json.
*/

// dieSides are the dice the tower carries. A coin is a d2, because it is.
var dieSides = map[int]bool{2: true, 4: true, 6: true, 8: true, 10: true, 12: true, 20: true, 100: true}

const (
	maxDice     = 100
	maxModifier = 100
)

type dieGroup struct {
	Count int
	Sides int
}

type dicePool struct {
	Groups   []dieGroup
	Modifier int
}

type rolledGroup struct {
	Sides   int
	Results []int
}

type poolResult struct {
	Expression string
	Groups     []rolledGroup
	Modifier   int
	Total      int
	Crit       bool
	Fail       bool
}

// normalizePool merges same-sided groups and drops the empty ones, largest die
// first — so a pool built by tapping d6 four times then twice more reads
// "6d6", and the order of tapping never changes the expression.
func normalizePool(pool dicePool) []dieGroup {
	bySides := map[int]int{}
	for _, g := range pool.Groups {
		if g.Count <= 0 || !dieSides[g.Sides] {
			continue
		}
		bySides[g.Sides] += g.Count
	}
	out := make([]dieGroup, 0, len(bySides))
	for sides, count := range bySides {
		out = append(out, dieGroup{Count: count, Sides: sides})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Sides > out[j].Sides })
	return out
}

// poolIsRollable reports whether the pool is something the tower will roll.
func poolIsRollable(pool dicePool) bool {
	groups := normalizePool(pool)
	if len(groups) == 0 {
		return false
	}
	dice := 0
	for _, g := range groups {
		dice += g.Count
	}
	if dice > maxDice {
		return false
	}
	if pool.Modifier > maxModifier || pool.Modifier < -maxModifier {
		return false
	}
	return true
}

// diceExpression is how a pool is written: "2d6 + 1d8 + 3". Empty when the
// pool is not rollable, which is also how a caller asks "is this anything?".
// The minus is a true minus sign, matching how the sheet writes them.
func diceExpression(pool dicePool) string {
	if !poolIsRollable(pool) {
		return ""
	}
	parts := make([]string, 0, len(pool.Groups))
	for _, g := range normalizePool(pool) {
		parts = append(parts, fmt.Sprintf("%dd%d", g.Count, g.Sides))
	}
	out := strings.Join(parts, " + ")
	if pool.Modifier > 0 {
		out += fmt.Sprintf(" + %d", pool.Modifier)
	}
	if pool.Modifier < 0 {
		out += fmt.Sprintf(" − %d", -pool.Modifier)
	}
	return out
}

// poolRange is the lowest and highest a pool can land on. ok is false when the
// pool is not rollable.
func poolRange(pool dicePool) (min, max int, ok bool) {
	if !poolIsRollable(pool) {
		return 0, 0, false
	}
	for _, g := range normalizePool(pool) {
		min += g.Count
		max += g.Count * g.Sides
	}
	return min + pool.Modifier, max + pool.Modifier, true
}

// rollPool rolls every die in the pool. ok is false when the pool is not
// rollable — the caller turns that into a 400 rather than an empty roll.
func rollPool(pool dicePool) (poolResult, bool) {
	if !poolIsRollable(pool) {
		return poolResult{}, false
	}
	norm := normalizePool(pool)
	groups := make([]rolledGroup, 0, len(norm))
	total := 0
	for _, g := range norm {
		results := make([]int, 0, g.Count)
		for i := 0; i < g.Count; i++ {
			face := 1 + rand.IntN(g.Sides)
			results = append(results, face)
			total += face
		}
		groups = append(groups, rolledGroup{Sides: g.Sides, Results: results})
	}
	lone20 := len(groups) == 1 && groups[0].Sides == 20 && len(groups[0].Results) == 1
	return poolResult{
		Expression: diceExpression(pool),
		Groups:     groups,
		Modifier:   pool.Modifier,
		Total:      total + pool.Modifier,
		Crit:       lone20 && groups[0].Results[0] == 20,
		Fail:       lone20 && groups[0].Results[0] == 1,
	}, true
}

// diceIn counts the dice actually rolled, across every group.
func diceIn(r poolResult) int {
	n := 0
	for _, g := range r.Groups {
		n += len(g.Results)
	}
	return n
}

// facesOf is every face that came up: "8, 3, 2".
func facesOf(r poolResult) string {
	faces := make([]string, 0, 8)
	for _, g := range r.Groups {
		for _, face := range g.Results {
			faces = append(faces, fmt.Sprint(face))
		}
	}
	return strings.Join(faces, ", ")
}

// rollLine is the sentence the chronicle keeps. The dice are spelled out
// beside the total because "Bramble rolls 27" is a claim, and "8d6: 5, 3, 6,
// 1, 4, 4, 2, 2 = 27" is a roll anyone at the table can check.
//
// Plain text, deliberately: the chronicle prints a message as-is, so markup
// here would reach the feed as literal asterisks.
func rollLine(actor, label string, r poolResult) string {
	var b strings.Builder
	b.WriteString(actor)
	b.WriteString(" rolls ")
	if label != "" {
		b.WriteString(label)
		b.WriteString(" — ")
	}
	b.WriteString(r.Expression)
	b.WriteString(": ")
	b.WriteString(facesOf(r))
	if r.Modifier > 0 {
		b.WriteString(fmt.Sprintf(" + %d", r.Modifier))
	}
	if r.Modifier < 0 {
		b.WriteString(fmt.Sprintf(" − %d", -r.Modifier))
	}
	// One die and nothing added to it is already its own total; "1d20: 18 = 18"
	// reads like the log is showing its working for no reason.
	if diceIn(r) > 1 || r.Modifier != 0 {
		b.WriteString(fmt.Sprintf(" = %d", r.Total))
	}
	switch {
	case r.Crit:
		b.WriteString(" — a natural 20!")
	case r.Fail:
		b.WriteString(" — a natural 1.")
	}
	return b.String()
}
