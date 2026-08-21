package http

/*
The till (#174), and the coin a table counts in (#195).

A stock line's price is free text and stays that way — "a favor owed" is a
legal thing for a trader to ask, it simply is not something the till can
charge. What the till CAN charge is anything shaped like a cost: a number and
one of the campaign's own coins ("15 gp", "1.5 pp", "3 glimmer", "5,000 crn").

Everything is reckoned in BASE units — the ladder's smallest coin — because
that is the only unit every price and every purse can be stated in exactly.
A hero's purse counts base units for the same reason, and is broken back into
coins only for display.

Sub-base remainders round UP, which is the shopkeeper's handling fee and the
one piece of #174 worth keeping: a price of half a copper costs a copper.

Mirrored by frontend/src/lib/money.ts so the Buy button and the till agree on
affordability without a round trip; both are held to
fixtures/rules/price-coins.json.
*/

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Coin is one rung of a campaign's ladder. Value is in base units, so the
// smallest coin is always 1.
type Coin struct {
	Name   string `json:"name"`
	Abbrev string `json:"abbrev"`
	Value  int64  `json:"value"`
}

// Coinage is a campaign's ladder, ascending. Never empty in practice: an
// absent one reads as the standard.
type Coinage struct {
	Coins []Coin `json:"coins"`
}

// standardCoinage is what every table had before a DM could say otherwise, and
// what a campaign with no ladder of its own still means. The base is copper,
// which is why a purse counts coppers.
var standardCoinage = Coinage{Coins: []Coin{
	{Name: "Copper Pieces", Abbrev: "cp", Value: 1},
	{Name: "Silver Pieces", Abbrev: "sp", Value: 10},
	{Name: "Electrum Pieces", Abbrev: "ep", Value: 50},
	{Name: "Gold Pieces", Abbrev: "gp", Value: 100},
	{Name: "Platinum Pieces", Abbrev: "pp", Value: 1000},
}}

// coinageOf reads a campaign's ladder, falling back to the standard one. A
// malformed or empty ladder reads as standard too: money is not a place to
// surface a decoding error, and the writer already refused anything invalid.
func coinageOf(raw []byte) Coinage {
	if len(raw) == 0 {
		return standardCoinage
	}
	var c Coinage
	if err := json.Unmarshal(raw, &c); err != nil || len(c.Coins) == 0 {
		return standardCoinage
	}
	sort.SliceStable(c.Coins, func(i, j int) bool { return c.Coins[i].Value < c.Coins[j].Value })
	return c
}

// purseName is what a hero's coin row is called at this table — the coin a
// table talks in, which is gold where there is gold and the largest rung
// otherwise. Exactly goldWorth's rule, and for the same reason: the standard
// ladder's top rung is platinum, and nobody calls their purse a purse of
// platinum. It also keeps the name every existing purse already has.
func (c Coinage) purseName() string {
	return c.Coins[c.goldRung()].Name
}

// goldRung is the index of the coin that stands in for gold.
func (c Coinage) goldRung() int {
	for i, coin := range c.Coins {
		if strings.EqualFold(coin.Abbrev, "gp") {
			return i
		}
	}
	return len(c.Coins) - 1
}

// priceShape is a number — with optional thousands commas and fraction — and
// one coin. The coin is matched against the ladder afterwards rather than
// baked into the pattern, because the ladder is the campaign's to name.
var priceShape = regexp.MustCompile(`^(\d{1,3}(?:,\d{3})*)(?:\.(\d+))?\s?([\p{L}]{1,16})$`)

// priceBase reads a price in base units, rounding a sub-base remainder up. The
// second return is false for anything the till cannot charge: prose, blanks, a
// coin this table does not use, or a fraction too long to be a price rather
// than a joke.
func priceBase(s string, ladder Coinage) (int64, bool) {
	m := priceShape.FindStringSubmatch(strings.ToLower(strings.TrimSpace(s)))
	if m == nil {
		return 0, false
	}
	whole, frac, coin := strings.ReplaceAll(m[1], ",", ""), m[2], m[3]
	if len(frac) > 6 {
		return 0, false
	}
	var value int64
	for _, c := range ladder.Coins {
		if strings.ToLower(c.Abbrev) == coin || strings.ToLower(c.Name) == coin {
			value = c.Value
			break
		}
	}
	if value == 0 {
		return 0, false
	}
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil || w > 100_000_000 {
		return 0, false
	}
	scale := int64(1)
	for range frac {
		scale *= 10
	}
	f := int64(0)
	if frac != "" {
		if f, err = strconv.ParseInt(frac, 10, 64); err != nil {
			return 0, false
		}
	}
	// base = ceil((w*scale + f) * value / scale)
	num := (w*scale + f) * value
	base := num / scale
	if num%scale != 0 {
		base++
	}
	return base, true
}

// goldWorth is what one gold piece is worth in base units here — the unit the
// books write starting coin and armory prices in. A table that invented its
// own ladder has no gold, so its largest coin stands in for one: a class's
// "10 gp to start" becomes ten of whatever the biggest coin at that table is,
// which is the reading a DM who renamed their money would expect.
func goldWorth(c Coinage) int64 { return c.Coins[c.goldRung()].Value }

// coinCounts is how many of each coin an amount comes to, one entry per rung,
// smallest first — the order the printed sheet's cells run in.
//
// It counts down from the coin the table TALKS in rather than from the top of
// the ladder, and the rungs above it stay empty. Forty gold pieces are forty
// gold pieces; no D&D table converts them up and calls it four platinum, and a
// purse that did would be arithmetically right and useless to read.
func coinCounts(base int64, ladder Coinage) []int64 {
	out := make([]int64, len(ladder.Coins))
	if base <= 0 {
		return out
	}
	left := base
	for i := ladder.goldRung(); i >= 0; i-- {
		c := ladder.Coins[i]
		out[i] = left / c.Value
		left -= out[i] * c.Value
	}
	return out
}

// formatCoins renders an amount of base units as the coins a table counts in,
// largest first, skipping the rungs that come to nothing: "4 crn 1 glm 2 shd".
// Zero is the smallest coin rather than nothing at all, because an empty purse
// still has a name.
func formatCoins(base int64, ladder Coinage) string {
	if base <= 0 {
		return "0 " + ladder.Coins[0].Abbrev
	}
	counts := coinCounts(base, ladder)
	parts := make([]string, 0, len(ladder.Coins))
	for i := len(ladder.Coins) - 1; i >= 0; i-- {
		if counts[i] > 0 {
			parts = append(parts, strconv.FormatInt(counts[i], 10)+" "+ladder.Coins[i].Abbrev)
		}
	}
	return strings.Join(parts, " ")
}
