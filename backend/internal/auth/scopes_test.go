package auth

import "testing"

func TestScopeLadder(t *testing.T) {
	cases := []struct {
		have, need Scope
		want       bool
	}{
		{CampaignsOwn, CampaignsRun, true},
		{CampaignsOwn, CampaignsPlay, true},
		{CampaignsOwn, CampaignsRead, true},
		{CampaignsRun, CampaignsPlay, true},
		{CampaignsRun, CampaignsOwn, false},
		{CampaignsPlay, CampaignsRun, false},
		{CampaignsRead, CampaignsPlay, false},
		{HeroesWrite, HeroesRead, true},
		{HeroesRead, HeroesWrite, false},
		{RulesWrite, RulesRead, true},
		{AccountWrite, AccountRead, true},
		// never across domains, however high the rung
		{CampaignsOwn, HeroesRead, false},
		{CampaignsOwn, RulesRead, false},
		{HeroesWrite, CampaignsRead, false},
		{Scope("campaigns:emperor"), CampaignsRead, false},
	}
	for _, c := range cases {
		if got := c.have.Implies(c.need); got != c.want {
			t.Errorf("%s implies %s: got %v, want %v", c.have, c.need, got, c.want)
		}
	}
}

func TestScopesHolds(t *testing.T) {
	held := Scopes{RulesRead, CampaignsRun}
	if !held.Holds(CampaignsPlay) || !held.Holds(RulesRead) {
		t.Fatal("run should cover play; read should cover read")
	}
	if held.Holds(CampaignsOwn) || held.Holds(RulesWrite) || held.Holds(HeroesRead) {
		t.Fatal("a token must not reach above its rung or into a domain it was not minted for")
	}
	if (Scopes{}).Holds(CampaignsRead) {
		t.Fatal("an empty grant holds nothing")
	}
}

func TestParseScope(t *testing.T) {
	for _, s := range AllScopes {
		if got, ok := ParseScope(string(s)); !ok || got != s {
			t.Errorf("%s should parse to itself", s)
		}
	}
	for _, bad := range []string{"", "campaigns", "campaigns:", "campaigns:delete", "Campaigns:Read", "*"} {
		if _, ok := ParseScope(bad); ok {
			t.Errorf("%q must not parse", bad)
		}
	}
}

func TestGrantHolds(t *testing.T) {
	session := Grant{Kind: GrantSession}
	for _, s := range AllScopes {
		if !session.Holds(s) {
			t.Errorf("a session holds every scope, missing %s", s)
		}
	}
	token := Grant{Kind: GrantToken, Scopes: Scopes{HeroesRead}}
	if !token.Holds(HeroesRead) || token.Holds(HeroesWrite) || token.Holds(CampaignsRead) {
		t.Fatal("a token holds exactly what it was minted with, and what that implies")
	}
}
