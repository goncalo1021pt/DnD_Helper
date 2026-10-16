package http

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

func TestRewardPayable(t *testing.T) {
	str := func(s string) *string { return &s }
	ladder := coinageOf(nil)
	cases := []struct {
		name string
		r    db.QuestReward
		gold int64
		ok   bool
	}{
		{"gold in coin", db.QuestReward{Type: db.RewardTypeGold, Value: str("50 gp")}, 5000, true},
		{"gold in two coins", db.QuestReward{Type: db.RewardTypeGold, Value: str("2 gp, 5 sp")}, 250, true},
		{"gold in words", db.QuestReward{Type: db.RewardTypeGold, Value: str("a sack of coins")}, 0, false},
		{"a bare number is not a coin", db.QuestReward{Type: db.RewardTypeGold, Value: str("500")}, 0, false},
		{"gold with nothing", db.QuestReward{Type: db.RewardTypeGold}, 0, false},
		{"item by name", db.QuestReward{Type: db.RewardTypeItem, Value: str("Flametongue")}, 0, true},
		{"item by id", db.QuestReward{Type: db.RewardTypeItem, ItemID: pgtype.UUID{Valid: true}}, 0, true},
		{"item with nothing", db.QuestReward{Type: db.RewardTypeItem}, 0, false},
		{"reputation stays words", db.QuestReward{Type: db.RewardTypeReputation, Value: str("+2 with the Temple")}, 0, false},
		{"xp stays with the xp flow", db.QuestReward{Type: db.RewardTypeXp, Value: str("700")}, 0, false},
	}
	for _, c := range cases {
		if got := rewardPayable(c.r, ladder); got != c.ok {
			t.Errorf("%s: payable = %v, want %v", c.name, got, c.ok)
		}
		if c.r.Type == db.RewardTypeGold {
			if amount, ok := rewardGold(c.r, ladder); ok != c.ok || amount != c.gold {
				t.Errorf("%s: gold = %d,%v want %d,%v", c.name, amount, ok, c.gold, c.ok)
			}
		}
	}
}
