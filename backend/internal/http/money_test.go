package http

import "testing"

// The Go half of the till's contract; the TS half is money.test.ts.
func TestPriceGpMatchesTheSharedFixture(t *testing.T) {
	var doc struct {
		Cases []struct {
			Name  string `json:"name"`
			Price string `json:"price"`
			Gp    *int   `json:"gp"`
		} `json:"cases"`
	}
	loadFixture(t, "price-gold.json", &doc)
	if len(doc.Cases) == 0 {
		t.Fatal("fixture has no cases")
	}
	refused := 0
	for _, c := range doc.Cases {
		gp, ok := priceGP(c.Price)
		if c.Gp == nil {
			if ok {
				t.Errorf("%s: %q should be refused, parsed as %d gp", c.Name, c.Price, gp)
			}
			refused++
			continue
		}
		if !ok {
			t.Errorf("%s: %q was refused, expected %d gp", c.Name, c.Price, *c.Gp)
			continue
		}
		if gp != *c.Gp {
			t.Errorf("%s: %q = %d gp, fixture says %d", c.Name, c.Price, gp, *c.Gp)
		}
	}
	// The refusals are half the rule — a fixture edit must not quietly drop them.
	if refused < 3 {
		t.Errorf("fixture carries %d refusal cases; the till's no is part of the contract", refused)
	}
}
