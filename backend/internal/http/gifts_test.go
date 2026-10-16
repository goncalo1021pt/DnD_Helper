package http

import "testing"

// A gift's coin is read in the table's own money, and anything the till
// cannot read is refused rather than guessed at (#394).
func TestParseGiftCoin(t *testing.T) {
	std := standardCoinage
	cases := []struct {
		in   string
		want int64
		bad  bool
	}{
		{"", 0, false},
		{"50 gp", 5000, false},
		{"2 gp, 5 sp", 250, false},
		{"1,000 gp", 100000, false},
		{"3 cp", 3, false},
		{"fifty gold", 0, true},
		{"50 crowns", 0, true},
		{"2 gp, oops", 0, true},
		{"2 gp and 5 sp", 250, false},
		{"oops 2 gp", 0, true},
		{"99999999 gp", 0, true},
	}
	for _, c := range cases {
		got, msg := parseGiftCoin(c.in, std)
		if (msg != "") != c.bad || (!c.bad && got != c.want) {
			t.Errorf("%q: got %d %q, want %d bad=%v", c.in, got, msg, c.want, c.bad)
		}
	}
	// A table that invented its money is read in it.
	shards := Coinage{Coins: []Coin{{Name: "Shard", Abbrev: "sh", Value: 1}, {Name: "Crown", Abbrev: "cr", Value: 20}}}
	if got, msg := parseGiftCoin("3 cr, 5 sh", shards); msg != "" || got != 65 {
		t.Errorf("shards and crowns: got %d %q", got, msg)
	}
}

func TestGiftLineReads(t *testing.T) {
	if got := (giftLine{name: "Torch", qty: 3}).text(); got != "3× Torch" {
		t.Errorf("got %q", got)
	}
	if got := (giftLine{name: "Rope", qty: 1}).text(); got != "Rope" {
		t.Errorf("got %q", got)
	}
	if got := joinGoods([]string{"3× Torch", "Rope", "50 gp"}); got != "3× Torch, Rope and 50 gp" {
		t.Errorf("got %q", got)
	}
}
