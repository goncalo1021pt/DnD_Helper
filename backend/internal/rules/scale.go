package rules

/*
Formulas for creatures that grow with the hero they belong to.

A companion's numbers are almost never constants. A Steel Defender has
"2 + your Intelligence modifier + five times your Artificer level" hit points;
a Wild Shape grants temporary hit points equal to your Druid level. Storing
those as a number means the sheet is wrong the moment the hero levels, and
making the player retype them is the chore this app exists to remove.

So a stat block may carry a `scale` object — field name to expression — which
is evaluated against the hero who owns the creature. The language is
deliberately tiny, because it is written by pack authors and evaluated on data
from outside this instance: four operators, parentheses, three functions, and a
fixed set of names. There are no variables to assign, no loops, and nothing
that can reach anything but the numbers below.

    5 * level + 2 + int          a Steel Defender's hit points
    floor(level / 2)             half your level, rounded down
    max(1, wis)                  a minimum of one

Names: level, prof, and the six ability modifiers (str, dex, con, int, wis,
cha). Each modifier is also available as a raw score — strScore, dexScore, and
so on — for the rare block that wants one.
*/

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// Scope is everything a formula is allowed to name: the hero it scales to.
type Scope struct {
	Level  int
	Prof   int
	Mods   map[string]int // "str".."cha" — ability modifiers
	Scores map[string]int // "str".."cha" — the raw scores behind them
}

// ScopeFor builds a scope from a hero's level and ability scores. Missing
// scores are treated as 10, the same assumption the sheet makes elsewhere.
func ScopeFor(level int, scores map[string]int) Scope {
	mods := map[string]int{}
	filled := map[string]int{}
	for _, ab := range []string{"str", "dex", "con", "int", "wis", "cha"} {
		score, ok := scores[ab]
		if !ok {
			score = 10
		}
		filled[ab] = score
		mods[ab] = int(math.Floor(float64(score-10) / 2))
	}
	return Scope{Level: level, Prof: ProfBonus(level), Mods: mods, Scores: filled}
}

// ProfBonus is the 2024 proficiency bonus for a level: +2 through +6.
func ProfBonus(level int) int {
	if level < 1 {
		level = 1
	}
	if level > 20 {
		level = 20
	}
	return 2 + (level-1)/4
}

// Eval computes an expression against a scope. The error names what went
// wrong so an import can refuse a malformed pack with something a human can
// act on, rather than silently scoring a companion at zero.
func Eval(expr string, scope Scope) (int, error) {
	p := &parser{src: []rune(expr), scope: scope}
	p.skipSpace()
	if p.done() {
		return 0, fmt.Errorf("empty expression")
	}
	v, err := p.expr()
	if err != nil {
		return 0, err
	}
	p.skipSpace()
	if !p.done() {
		return 0, fmt.Errorf("unexpected %q at position %d", string(p.src[p.i]), p.i)
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("expression is not a number")
	}
	// Down, not nearest: every rounding rule in the 2024 book rounds down.
	return int(math.Floor(v)), nil
}

// Check reports whether an expression parses and names only known values,
// without caring what it computes. Import-time validation, so a typo in a pack
// is a refusal at the door rather than a wrong number on a sheet months later.
func Check(expr string) error {
	_, err := Eval(expr, ScopeFor(1, nil))
	return err
}

type parser struct {
	src   []rune
	i     int
	scope Scope
}

func (p *parser) done() bool { return p.i >= len(p.src) }

func (p *parser) skipSpace() {
	for !p.done() && unicode.IsSpace(p.src[p.i]) {
		p.i++
	}
}

// peek returns the next non-space rune, or 0 at the end.
func (p *parser) peek() rune {
	p.skipSpace()
	if p.done() {
		return 0
	}
	return p.src[p.i]
}

func (p *parser) expr() (float64, error) {
	left, err := p.term()
	if err != nil {
		return 0, err
	}
	for {
		switch p.peek() {
		case '+', '-':
			op := p.src[p.i]
			p.i++
			right, err := p.term()
			if err != nil {
				return 0, err
			}
			if op == '+' {
				left += right
			} else {
				left -= right
			}
		default:
			return left, nil
		}
	}
}

func (p *parser) term() (float64, error) {
	left, err := p.unary()
	if err != nil {
		return 0, err
	}
	for {
		switch p.peek() {
		case '*', '/':
			op := p.src[p.i]
			p.i++
			right, err := p.unary()
			if err != nil {
				return 0, err
			}
			if op == '*' {
				left *= right
			} else {
				if right == 0 {
					return 0, fmt.Errorf("division by zero")
				}
				left /= right
			}
		default:
			return left, nil
		}
	}
}

func (p *parser) unary() (float64, error) {
	switch p.peek() {
	case '-':
		p.i++
		v, err := p.unary()
		return -v, err
	case '+':
		p.i++
		return p.unary()
	}
	return p.primary()
}

func (p *parser) primary() (float64, error) {
	c := p.peek()
	switch {
	case c == 0:
		return 0, fmt.Errorf("expression ends early")
	case c == '(':
		p.i++
		v, err := p.expr()
		if err != nil {
			return 0, err
		}
		if p.peek() != ')' {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.i++
		return v, nil
	case unicode.IsDigit(c) || c == '.':
		return p.number()
	case unicode.IsLetter(c):
		return p.name()
	}
	return 0, fmt.Errorf("unexpected %q at position %d", string(c), p.i)
}

func (p *parser) number() (float64, error) {
	start := p.i
	for !p.done() && (unicode.IsDigit(p.src[p.i]) || p.src[p.i] == '.') {
		p.i++
	}
	text := string(p.src[start:p.i])
	var v float64
	if _, err := fmt.Sscanf(text, "%g", &v); err != nil {
		return 0, fmt.Errorf("bad number %q", text)
	}
	return v, nil
}

// name resolves an identifier — either a call like floor(x) or a scope value.
func (p *parser) name() (float64, error) {
	start := p.i
	for !p.done() && (unicode.IsLetter(p.src[p.i]) || unicode.IsDigit(p.src[p.i])) {
		p.i++
	}
	word := string(p.src[start:p.i])

	if p.peek() == '(' {
		p.i++
		args := []float64{}
		for {
			v, err := p.expr()
			if err != nil {
				return 0, err
			}
			args = append(args, v)
			if p.peek() == ',' {
				p.i++
				continue
			}
			break
		}
		if p.peek() != ')' {
			return 0, fmt.Errorf("missing closing parenthesis after %s(", word)
		}
		p.i++
		return call(word, args)
	}

	lower := strings.ToLower(word)
	switch lower {
	case "level":
		return float64(p.scope.Level), nil
	case "prof":
		return float64(p.scope.Prof), nil
	}
	if strings.HasSuffix(lower, "score") {
		if v, ok := p.scope.Scores[strings.TrimSuffix(lower, "score")]; ok {
			return float64(v), nil
		}
	}
	if v, ok := p.scope.Mods[lower]; ok {
		return float64(v), nil
	}
	return 0, fmt.Errorf("unknown value %q — use level, prof, or an ability like int", word)
}

func call(name string, args []float64) (float64, error) {
	switch strings.ToLower(name) {
	case "floor":
		if len(args) != 1 {
			return 0, fmt.Errorf("floor takes one argument")
		}
		return math.Floor(args[0]), nil
	case "ceil":
		if len(args) != 1 {
			return 0, fmt.Errorf("ceil takes one argument")
		}
		return math.Ceil(args[0]), nil
	case "max":
		if len(args) < 2 {
			return 0, fmt.Errorf("max takes at least two arguments")
		}
		out := args[0]
		for _, a := range args[1:] {
			out = math.Max(out, a)
		}
		return out, nil
	case "min":
		if len(args) < 2 {
			return 0, fmt.Errorf("min takes at least two arguments")
		}
		out := args[0]
		for _, a := range args[1:] {
			out = math.Min(out, a)
		}
		return out, nil
	}
	return 0, fmt.Errorf("unknown function %q — floor, ceil, max and min are the whole list", name)
}
