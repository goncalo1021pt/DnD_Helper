package rules

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
)

/*
Will this fight flatten the party? (#110, #318)

The 2024 encounter maths: three bands, a budget per character by level, and no
multiplier for numbers. It was born in the builder (frontend/src/lib/
encounterDifficulty.ts, where the reasoning about editions and XP sources is
written out) and lives here too because the MCP server answers the same
question without a browser. Two implementations of one rule are held together
by fixtures/rules/encounter-difficulty.json, and neither may drift alone.

A creature's XP is read off its own `cr` string first — "1/4 (XP 50; PB +2)" —
because that is what the book says for that creature, which is not always what
the CR table says. The table is only the fallback for homebrew that states a CR
and no XP.
*/

// Band is where a fight's XP lands against the party's budget.
type Band string

const (
	BandTrivial  Band = "trivial"
	BandLow      Band = "low"
	BandModerate Band = "moderate"
	BandHigh     Band = "high"
)

// Budget is what a party can take, in XP, at each band's floor.
type Budget struct {
	Low      int `json:"low"`
	Moderate int `json:"moderate"`
	High     int `json:"high"`
}

// xpBudget is the 2024 DMG's XP budget per character; index 0 is unused so
// the level reads as the index.
var xpBudget = [21]Budget{
	{0, 0, 0},
	{50, 75, 100}, {100, 150, 200}, {150, 225, 400}, {250, 375, 500},
	{500, 750, 1100}, {600, 1000, 1400}, {750, 1300, 1700}, {1000, 1700, 2100},
	{1300, 2000, 2600}, {1600, 2300, 3100}, {1900, 2900, 4100}, {2200, 3700, 4700},
	{2600, 4200, 5400}, {2900, 4900, 6200}, {3300, 5400, 7800}, {3800, 6100, 9800},
	{4500, 7200, 11700}, {5000, 8700, 14200}, {5500, 10700, 17200}, {6400, 13200, 22000},
}

// xpByCR is standard XP by challenge rating.
var xpByCR = map[float64]int{
	0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
	1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
	9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
	16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000,
	23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000,
	29: 135000, 30: 155000,
}

var (
	xpAfter  = regexp.MustCompile(`(?i)XP\s*([\d,]+)`)
	xpBefore = regexp.MustCompile(`(?i)([\d,]+)\s*XP`)
)

// MonsterXP is what one creature is worth, from its content data. A lair's
// second number ("XP 18,000, or 20,000 in lair") is ignored: the first wins.
func MonsterXP(data []byte) int {
	var d struct {
		CR      string   `json:"cr"`
		CRValue *float64 `json:"crValue"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return 0
	}
	m := xpAfter.FindStringSubmatch(d.CR)
	if m == nil {
		m = xpBefore.FindStringSubmatch(d.CR)
	}
	if m != nil {
		n, err := strconv.Atoi(strings.ReplaceAll(m[1], ",", ""))
		if err == nil {
			return n
		}
	}
	if d.CRValue != nil {
		return xpByCR[*d.CRValue]
	}
	return 0
}

// PartyBudget sums the per-character budget over everyone turning up. A level
// outside 1–20 is clamped to it, rounding to the nearest level.
func PartyBudget(levels []int) Budget {
	var b Budget
	for _, l := range levels {
		row := xpBudget[int(math.Min(math.Max(float64(l), 1), 20))]
		b.Low += row.Low
		b.Moderate += row.Moderate
		b.High += row.High
	}
	return b
}

// BandFor says which band a total lands in. The bands are floors: there is
// nothing above high, and below low is "trivial", which the 2024 rules do not
// name but a DM still wants told.
func BandFor(totalXP int, b Budget) Band {
	switch {
	case b.Low == 0 || totalXP <= 0:
		return BandTrivial
	case totalXP >= b.High:
		return BandHigh
	case totalXP >= b.Moderate:
		return BandModerate
	case totalXP >= b.Low:
		return BandLow
	}
	return BandTrivial
}
