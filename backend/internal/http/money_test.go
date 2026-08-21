package http

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/*
The till and the campaign's own coin, held to one contract (#174, #195).

priceBase and formatCoins exist twice — here and in frontend/src/lib/money.ts —
because the server is the one that charges and the Buy button has to know
affordability without a round trip. Two implementations of money is a thing
worth being nervous about, so both are held to
fixtures/rules/price-coins.json and neither may drift alone.
*/

type coinCase struct {
	Name   string `json:"name"`
	Ladder string `json:"ladder"`
	Price  string `json:"price"`
	Base   *int64 `json:"base"`
}

type purseCase struct {
	Name   string `json:"name"`
	Ladder string `json:"ladder"`
	Base   int64  `json:"base"`
	Coins  string `json:"coins"`
}

type coinContract struct {
	Standard []Coin      `json:"standard"`
	Invented []Coin      `json:"invented"`
	Cases    []coinCase  `json:"cases"`
	Purses   []purseCase `json:"purses"`
}

func loadCoinContract(t *testing.T) coinContract {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "fixtures", "rules", "price-coins.json"))
	if err != nil {
		t.Fatalf("reading the contract: %v", err)
	}
	var c coinContract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parsing the contract: %v", err)
	}
	return c
}

func (c coinContract) ladder(name string) Coinage {
	if name == "invented" {
		return Coinage{Coins: c.Invented}
	}
	return Coinage{Coins: c.Standard}
}

func TestPriceBaseMatchesTheContract(t *testing.T) {
	c := loadCoinContract(t)
	if len(c.Cases) == 0 {
		t.Fatal("the contract has no cases — it would pass by saying nothing")
	}
	for _, tc := range c.Cases {
		got, ok := priceBase(tc.Price, c.ladder(tc.Ladder))
		switch {
		case tc.Base == nil && ok:
			t.Errorf("%s: %q should not be chargeable, got %d", tc.Name, tc.Price, got)
		case tc.Base != nil && !ok:
			t.Errorf("%s: %q should charge %d, but the till refused it", tc.Name, tc.Price, *tc.Base)
		case tc.Base != nil && got != *tc.Base:
			t.Errorf("%s: %q charged %d, want %d", tc.Name, tc.Price, got, *tc.Base)
		}
	}
}

func TestFormatCoinsMatchesTheContract(t *testing.T) {
	c := loadCoinContract(t)
	if len(c.Purses) == 0 {
		t.Fatal("the contract has no purses to read back")
	}
	for _, tc := range c.Purses {
		if got := formatCoins(tc.Base, c.ladder(tc.Ladder)); got != tc.Coins {
			t.Errorf("%s: %d base reads as %q, want %q", tc.Name, tc.Base, got, tc.Coins)
		}
	}
}

// The standard ladder is what a campaign with no coinage of its own means, and
// a malformed one must not be able to leave a table with no money at all.
func TestAnAbsentOrBrokenLadderReadsAsTheStandard(t *testing.T) {
	for _, raw := range [][]byte{nil, {}, []byte("{}"), []byte(`{"coins":[]}`), []byte("not json")} {
		got := coinageOf(raw)
		if len(got.Coins) != len(standardCoinage.Coins) || got.Coins[0].Abbrev != "cp" {
			t.Fatalf("%q should read as the standard ladder, got %+v", raw, got.Coins)
		}
	}
}

func TestALadderIsSortedSmallestFirstHoweverItArrives(t *testing.T) {
	out := coinageOf([]byte(`{"coins":[{"name":"Crown","abbrev":"crn","value":100},{"name":"Shard","abbrev":"shd","value":1}]}`))
	if out.Coins[0].Abbrev != "shd" || out.Coins[1].Abbrev != "crn" {
		t.Fatalf("the base must come first whatever order it was written in, got %+v", out.Coins)
	}
	if out.purseName() != "Crown" {
		t.Fatalf("with no gold minted, the largest coin names the purse, got %q", out.purseName())
	}
	// And the standard ladder's purse keeps the name every purse already has —
	// gold, not the platinum sitting above it.
	if got := standardCoinage.purseName(); got != "Gold Pieces" {
		t.Fatalf("nobody calls their purse a purse of platinum, got %q", got)
	}
}

// A class's starting coin is written in gold, so a table with no gold needs a
// stand-in or a freshly forged hero would start with a hundredth of nothing.
func TestGoldWorthFallsBackToTheLargestCoin(t *testing.T) {
	if got := goldWorth(standardCoinage); got != 100 {
		t.Fatalf("a gold is a hundred copper on the standard ladder, got %d", got)
	}
	invented := Coinage{Coins: []Coin{
		{Name: "Shard", Abbrev: "shd", Value: 1},
		{Name: "Crown", Abbrev: "crn", Value: 100},
	}}
	if got := goldWorth(invented); got != 100 {
		t.Fatalf("with no gold minted, the largest coin stands in; got %d", got)
	}
}
