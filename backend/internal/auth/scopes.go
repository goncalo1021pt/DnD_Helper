package auth

import "strings"

// Scope is what a caller may touch: a domain and a verb, `campaigns:run`.
//
// A scope says what *kind* of thing a token may reach; the handler's own guard
// (requireMember, requireDM, requireOwner, …) still says who the caller is to
// that thing. So "rest a hero" is heroes:write whether the caller is its owner
// or the DM, and a stranger is refused by the guard exactly as before — the
// scope stands in front of the guard, never in its place (#313).
//
// Every operation in the spec declares the one scope it needs
// (`security: bearerToken: [campaigns:run]`), a test walks the bundled spec so
// a new endpoint cannot forget, and a session holds every scope. Tokens (#294)
// hold the ones they were minted with.
type Scope string

const (
	RulesRead     Scope = "rules:read"     // the codex shelves and homebrew, reading
	RulesWrite    Scope = "rules:write"    // authoring homebrew, importing a pack
	HeroesRead    Scope = "heroes:read"    // a hero's sheet and what it grants
	HeroesWrite   Scope = "heroes:write"   // what a hero's owner does to it
	CampaignsRead Scope = "campaigns:read" // everything a member reads at a table
	CampaignsPlay Scope = "campaigns:play" // what a player does at a table
	CampaignsRun  Scope = "campaigns:run"  // what a DM does
	CampaignsOwn  Scope = "campaigns:own"  // reshape or end the table: disband, hand over, realms, the cascading strikes
	AccountRead   Scope = "account:read"   // the person's own things: /me, friends, inbox
	AccountWrite  Scope = "account:write"  // friends, blocks, messages
)

// AllScopes lists the vocabulary in the order a picker shows it.
var AllScopes = []Scope{
	RulesRead, RulesWrite,
	HeroesRead, HeroesWrite,
	CampaignsRead, CampaignsPlay, CampaignsRun, CampaignsOwn,
	AccountRead, AccountWrite,
}

// rung orders the verbs within a domain: a higher rung implies every lower one.
// `write` implies `read`; the campaigns ladder runs own > run > play > read,
// because the owner is always a DM and a DM can do whatever a member can.
var rung = map[Scope]int{
	RulesRead: 0, RulesWrite: 1,
	HeroesRead: 0, HeroesWrite: 1,
	CampaignsRead: 0, CampaignsPlay: 1, CampaignsRun: 2, CampaignsOwn: 3,
	AccountRead: 0, AccountWrite: 1,
}

// ParseScope reads a scope off the wire, refusing anything outside the vocabulary.
func ParseScope(s string) (Scope, bool) {
	sc := Scope(s)
	_, ok := rung[sc]
	return sc, ok
}

// Domain is the part before the colon: "campaigns" for campaigns:run.
func (s Scope) Domain() string {
	d, _, _ := strings.Cut(string(s), ":")
	return d
}

// Implies reports whether holding s satisfies a door that asks for need.
func (s Scope) Implies(need Scope) bool {
	if s.Domain() != need.Domain() {
		return false
	}
	have, ok := rung[s]
	if !ok {
		return false
	}
	want, ok := rung[need]
	if !ok {
		return false
	}
	return have >= want
}

// Scopes is what a caller holds.
type Scopes []Scope

// Holds reports whether any held scope satisfies need.
func (ss Scopes) Holds(need Scope) bool {
	for _, s := range ss {
		if s.Implies(need) {
			return true
		}
	}
	return false
}
