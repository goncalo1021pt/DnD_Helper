package http

/*
The till (#174). Gold only, on purpose.

A stock line's price is free text and stays that way — "a favor owed" is a
legal thing for a trader to ask, it simply is not something the till can
charge. What the till CAN charge is anything shaped like an armory cost
("15 gp", "5 sp", "1.5 pp", "5,000 gp"), converted to whole gold pieces with
sub-gold remainders rounded UP — the shopkeeper's handling fee. The purse is
a single Gold Pieces row; real coin denominations (and DM-invented currency)
are #195's business, and the free-text price is the door it walks in through.

Mirrored by priceGp in frontend/src/lib/money.ts so the Buy button and the
till agree on affordability; both are held to fixtures/rules/price-gold.json.
*/

import (
	"regexp"
	"strconv"
	"strings"
)

// priceRe is costRe's shape (rules_edit.go) with capture groups: whole part
// with optional thousands commas, optional fraction, one coin.
var priceRe = regexp.MustCompile(`^(\d{1,3}(?:,\d{3})*)(?:\.(\d+))?\s?(cp|sp|ep|gp|pp)$`)

// Coin values in gold, as fractions — integer arithmetic only, because money.
var coinGpNum = map[string]int64{"cp": 1, "sp": 1, "ep": 1, "gp": 1, "pp": 10}
var coinGpDen = map[string]int64{"cp": 100, "sp": 10, "ep": 2, "gp": 1, "pp": 1}

// priceGP reads a price as whole gold pieces, rounding sub-gold up. The
// second return is false for anything the till cannot charge: prose, blanks,
// or a fraction too long to be a price rather than a joke.
func priceGP(s string) (int, bool) {
	m := priceRe.FindStringSubmatch(strings.ToLower(strings.TrimSpace(s)))
	if m == nil {
		return 0, false
	}
	whole, frac, coin := strings.ReplaceAll(m[1], ",", ""), m[2], m[3]
	if len(frac) > 6 {
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
		f, err = strconv.ParseInt(frac, 10, 64)
		if err != nil {
			return 0, false
		}
	}
	// gp = ceil((w*scale + f) * num / (scale * den))
	num := (w*scale + f) * coinGpNum[coin]
	den := scale * coinGpDen[coin]
	gp := num / den
	if num%den != 0 {
		gp++
	}
	return int(gp), true
}
