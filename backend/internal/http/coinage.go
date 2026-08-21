package http

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Naming a table's money (#195).

#174 shipped gold only and said where this would slot in. A DM can now define
their own coins, and the Bazaar prices and charges in them.

The one thing this deliberately does NOT do is convert anybody's purse. An
invented coin has no rate against the one it replaces — a shard is not worth
some number of the gold pieces it is standing in for, it is simply what this
table uses now — so the numbers stand and their meaning changes. That makes
coinage something to settle before play rather than during it, and the screen
says so before it lets a DM through.
*/

const maxCoins = 8

var coinAbbrev = regexp.MustCompile(`^\p{L}{1,8}$`)

// validateCoinage bounds a ladder and puts it in order. The middle return is a
// client-facing reason, empty when the ladder is good; a nil first return means
// "back to the standard coins".
func validateCoinage(coins []api.Coin) ([]Coin, string) {
	if len(coins) == 0 {
		return nil, ""
	}
	if len(coins) > maxCoins {
		return nil, "a ladder of more than eight coins is a bureau, not a purse"
	}
	out := make([]Coin, 0, len(coins))
	seenAbbrev := map[string]bool{}
	seenValue := map[int64]bool{}
	for _, c := range coins {
		name := strings.TrimSpace(c.Name)
		abbrev := strings.TrimSpace(c.Abbrev)
		if name == "" || len([]rune(name)) > 40 {
			return nil, "a coin's name must be between 1 and 40 characters"
		}
		if !coinAbbrev.MatchString(abbrev) {
			return nil, "a coin's short form is one to eight letters, and nothing else — it has to read as a price"
		}
		if c.Value < 1 {
			return nil, "a coin must be worth at least one of the smallest"
		}
		low := strings.ToLower(abbrev)
		if seenAbbrev[low] {
			return nil, "two coins share the short form " + abbrev + " — a price could not say which"
		}
		if seenValue[int64(c.Value)] {
			return nil, "two coins are worth the same, so a purse could not be counted out"
		}
		seenAbbrev[low], seenValue[int64(c.Value)] = true, true
		out = append(out, Coin{Name: name, Abbrev: abbrev, Value: int64(c.Value)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Value < out[j].Value })
	// The base is the smallest coin, so it is worth one by definition. A
	// ladder starting at 5 would make every price a fraction of nothing.
	if out[0].Value != 1 {
		return nil, "the smallest coin is the one everything is counted in, so it must be worth exactly 1"
	}
	return out, ""
}

func toAPICoins(c Coinage) []api.Coin {
	out := make([]api.Coin, 0, len(c.Coins))
	for _, coin := range c.Coins {
		out = append(out, api.Coin{Name: coin.Name, Abbrev: coin.Abbrev, Value: int(coin.Value)})
	}
	return out
}

// SetCoinage names the coins a table counts in (DM only).
func (s *Server) SetCoinage(ctx context.Context, request api.SetCoinageRequestObject) (api.SetCoinageResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetCoinage401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetCoinage403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.SetCoinage400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a ladder is required"}}, nil
	}
	ladder, msg := validateCoinage(request.Body.Coins)
	if msg != "" {
		return api.SetCoinage400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}

	var raw []byte
	if ladder != nil {
		if raw, err = json.Marshal(Coinage{Coins: ladder}); err != nil {
			return nil, err
		}
	}
	updated, err := s.queries.SetCoinage(ctx, db.SetCoinageParams{ID: campaignID, Coinage: raw})
	if err != nil {
		return nil, err
	}
	named := coinageOf(updated.Coinage).purseName()
	s.logEvent(ctx, campaignID, member.UserID, "table_rules",
		"The table counts its money in "+named+" from now on")

	out, err := s.campaignOut(ctx, updated, true)
	if err != nil {
		return nil, err
	}
	return api.SetCoinage200JSONResponse(out), nil
}
