package http

import (
	"context"
	"errors"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
One box over a table (#321).

The answer is composed the way /me/export (#317) and the MCP tools (#318) are:
by calling the list handlers in-process with the caller's own context and
matching text over their 200s. That is the whole veil story — search reads
exactly what the viewer's screens already receive, so a veiled innkeeper is
not found, a DM's draft is found by the DM alone, and a veil added to any shelf
later is honoured here without anybody remembering this file exists. The
question the issue left open, whether a hit may show a snippet, answers itself
the same way: a snippet is cut from text the viewer was already sent.

The rules join in as this table's codex rules them — `ListRules` is not
campaign-scoped, so a banned SRD entry, or homebrew admitted only at another of
the viewer's tables, is dropped here exactly as the Codex page drops it. The
Den's monsters are offered to this table's DMs alone; a player meets creatures
through the Bestiary, which carries only what has been revealed.

No full-text index: every one of these lists is small and already read whole by
its handler. The chronicle is the one shelf that grows without end, so it is
read to searchChronicleDepth lines back and no further.
*/

const (
	searchMinRunes = 2
	// Below this many characters a query only finds names with a word that
	// starts with it: "va" should find Vallaki, not every Deva and Servant.
	searchLooseRunes     = 3
	searchPerKind        = 8
	searchChronicleDepth = 2000
	snippetBefore        = 40
	snippetAfter         = 90
)

// searchRulesKinds are the rules a member may read, in the order they are
// shown; monsters are added for a DM of this table.
var searchRulesKinds = []api.ContentKind{
	api.ContentKindSpell, api.ContentKindItem, api.ContentKindFeat, api.ContentKindRule,
	api.ContentKindClass, api.ContentKindSubclass, api.ContentKindSpecies, api.ContentKindBackground,
}

// folded is a text with case and accents taken off, keeping for every rune
// where in the original it came from, so a match found in the folded text can
// be cut back out of the original one.
type folded struct {
	runes []rune
	from  []int // index into orig for each folded rune
	orig  []rune
}

func fold(s string) folded {
	f := folded{orig: []rune(s)}
	for i, r := range f.orig {
		for _, d := range norm.NFD.String(string(r)) {
			if unicode.Is(unicode.Mn, d) {
				continue
			}
			f.runes = append(f.runes, unicode.ToLower(d))
			f.from = append(f.from, i)
		}
	}
	return f
}

// wordStart reports whether folded position at begins a word.
func (f folded) wordStart(at int) bool {
	return at == 0 || !unicode.IsLetter(f.runes[at-1]) && !unicode.IsDigit(f.runes[at-1])
}

// wordIndex is where q first appears at the start of a word; -1 when it does not.
func (f folded) wordIndex(q []rune) int {
	for at := f.index(q); at >= 0; {
		if f.wordStart(at) {
			return at
		}
		next := folded{runes: f.runes[at+1:]}.index(q)
		if next < 0 {
			return -1
		}
		at += 1 + next
	}
	return -1
}

// index is where q first appears in f, in folded runes; -1 when it does not.
func (f folded) index(q []rune) int {
	if len(q) == 0 || len(q) > len(f.runes) {
		return -1
	}
outer:
	for i := 0; i+len(q) <= len(f.runes); i++ {
		for j, r := range q {
			if f.runes[i+j] != r {
				continue outer
			}
		}
		return i
	}
	return -1
}

// snippet is the original words around a match at folded position at, with
// whitespace collapsed and an ellipsis where it was cut.
func (f folded) snippet(at, n int) string {
	start := f.from[at]
	end := f.from[at+n-1] + 1
	lo, hi := max(0, start-snippetBefore), min(len(f.orig), end+snippetAfter)
	// Cut on whole words: step forward to a space at the start and back to
	// one at the end, never past the match itself.
	for lo > 0 && lo < start && !unicode.IsSpace(f.orig[lo-1]) {
		lo++
	}
	for hi < len(f.orig) && hi > end && !unicode.IsSpace(f.orig[hi]) {
		hi--
	}
	out := strings.Join(strings.Fields(string(f.orig[lo:hi])), " ")
	if lo > 0 {
		out = "…" + out
	}
	if hi < len(f.orig) {
		out += "…"
	}
	return out
}

// candidate is one thing a shelf offers, before it is matched.
type candidate struct {
	id       [16]byte
	title    string
	subtitle string
	body     []string // the texts a match may also be found in, in order
}

// rank is how good a hit is: lower is better. A name that starts with the
// query (or has a word that does) beats one that merely contains it, which
// beats a match in the text alone.
type rankedHit struct {
	hit  api.SearchHit
	rank int
}

func matchCandidate(kind api.SearchKind, c candidate, q []rune) (rankedHit, bool) {
	hit := func(rank int, snippet *string) (rankedHit, bool) {
		h := api.SearchHit{Kind: kind, Id: c.id, Title: c.title, NameMatch: snippet == nil, Snippet: snippet}
		if c.subtitle != "" {
			h.Subtitle = &c.subtitle
		}
		return rankedHit{h, rank}, true
	}
	ft := fold(c.title)
	if ft.wordIndex(q) >= 0 {
		return hit(0, nil)
	}
	if len(q) < searchLooseRunes {
		return rankedHit{}, false
	}
	if ft.index(q) >= 0 {
		return hit(1, nil)
	}
	for _, b := range c.body {
		fb := fold(b)
		if at := fb.index(q); at >= 0 {
			snip := fb.snippet(at, len(q))
			return hit(2, &snip)
		}
	}
	return rankedHit{}, false
}

// collect matches one shelf, keeps the best searchPerKind and counts them all.
func collect(out *api.SearchResults, kind api.SearchKind, cs []candidate, q []rune) {
	var hits []rankedHit
	for _, c := range cs {
		if h, ok := matchCandidate(kind, c, q); ok {
			hits = append(hits, h)
		}
	}
	if len(hits) == 0 {
		return
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].rank != hits[j].rank {
			return hits[i].rank < hits[j].rank
		}
		if len(hits[i].hit.Title) != len(hits[j].hit.Title) {
			return len(hits[i].hit.Title) < len(hits[j].hit.Title)
		}
		return hits[i].hit.Title < hits[j].hit.Title
	})
	out.Counts[string(kind)] = len(hits)
	for i, h := range hits {
		if i == searchPerKind {
			break
		}
		out.Hits = append(out.Hits, h.hit)
	}
}

func (s *Server) SearchCampaign(ctx context.Context, request api.SearchCampaignRequestObject) (api.SearchCampaignResponseObject, error) {
	id := request.CampaignId
	member, err := s.requireMember(ctx, id)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SearchCampaign401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SearchCampaign403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	query := strings.Join(strings.Fields(request.Params.Q), " ")
	out := api.SearchResults{Query: query, Hits: []api.SearchHit{}, Counts: map[string]int{}}
	q := fold(query).runes
	if len(q) < searchMinRunes {
		return api.SearchCampaign200JSONResponse(out), nil
	}

	// Each shelf below is the 200 its own screen reads; a non-200 drops the
	// shelf, never the search.
	if v, ok, err := as[api.ListLocations200JSONResponse](s.ListLocations(ctx, api.ListLocationsRequestObject{CampaignId: id})); err != nil {
		return nil, err
	} else if ok {
		cs := make([]candidate, 0, len(v))
		for _, l := range v {
			cs = append(cs, candidate{id: l.Id, title: l.Name, body: []string{l.Description}})
		}
		collect(&out, api.HitPlace, cs, q)
	}
	if v, ok, err := as[api.ListNpcs200JSONResponse](s.ListNpcs(ctx, api.ListNpcsRequestObject{CampaignId: id})); err != nil {
		return nil, err
	} else if ok {
		cs := make([]candidate, 0, len(v))
		for _, n := range v {
			c := candidate{id: n.Id, title: n.Name, body: []string{n.Description}}
			switch {
			case n.Traveling != nil && *n.Traveling:
				c.subtitle = "Traveling with you"
			case n.LocationName != nil:
				c.subtitle = *n.LocationName
			}
			cs = append(cs, c)
		}
		collect(&out, api.HitPerson, cs, q)
	}
	if v, ok, err := as[api.ListQuests200JSONResponse](s.ListQuests(ctx, api.ListQuestsRequestObject{CampaignId: id})); err != nil {
		return nil, err
	} else if ok {
		cs := make([]candidate, 0, len(v))
		for _, qu := range v {
			c := candidate{id: qu.Id, title: qu.Title, subtitle: string(qu.Status), body: []string{qu.Description}}
			if qu.Giver != nil {
				c.body = append(c.body, *qu.Giver)
			}
			if qu.Location != nil {
				c.subtitle += " · " + *qu.Location
			}
			cs = append(cs, c)
		}
		collect(&out, api.HitQuest, cs, q)
	}
	if v, ok, err := as[api.ListHandouts200JSONResponse](s.ListHandouts(ctx, api.ListHandoutsRequestObject{CampaignId: id})); err != nil {
		return nil, err
	} else if ok {
		cs := make([]candidate, 0, len(v))
		for _, h := range v {
			cs = append(cs, candidate{id: h.Id, title: h.Title, body: []string{h.Caption}})
		}
		collect(&out, api.HitHandout, cs, q)
	}
	if v, ok, err := as[api.ListMaps200JSONResponse](s.ListMaps(ctx, api.ListMapsRequestObject{CampaignId: id})); err != nil {
		return nil, err
	} else if ok {
		cs := make([]candidate, 0, len(v))
		for _, m := range v {
			c := candidate{id: m.Id, title: m.Name}
			if m.LocationName != nil {
				c.subtitle = *m.LocationName
			}
			cs = append(cs, c)
		}
		collect(&out, api.HitMap, cs, q)
	}
	depth := searchChronicleDepth
	if v, ok, err := as[api.ListEvents200JSONResponse](s.ListEvents(ctx, api.ListEventsRequestObject{CampaignId: id, Params: api.ListEventsParams{Limit: &depth}})); err != nil {
		return nil, err
	} else if ok {
		// A line has no name of its own, so it is matched in its text alone —
		// matching who wrote it would turn a name into every line they wrote.
		// Its title is when and by whom, and the order is the chronicle's own,
		// newest first.
		n := 0
		for _, e := range v {
			if len(q) < searchLooseRunes {
				break
			}
			fb := fold(e.Message)
			at := fb.index(q)
			if at < 0 {
				continue
			}
			if n++; n > searchPerKind {
				continue
			}
			title := e.CreatedAt.UTC().Format("2 Jan 2006")
			if e.ActorName != nil && *e.ActorName != "" {
				title += " · " + *e.ActorName
			}
			snip := fb.snippet(at, len(q))
			out.Hits = append(out.Hits, api.SearchHit{Kind: api.HitChronicle, Id: e.Id, Title: title, Snippet: &snip})
		}
		if n > 0 {
			out.Counts[string(api.HitChronicle)] = n
		}
	}
	if v, ok, err := as[api.ListBestiary200JSONResponse](s.ListBestiary(ctx, api.ListBestiaryRequestObject{CampaignId: id})); err != nil {
		return nil, err
	} else if ok {
		cs := make([]candidate, 0, len(v))
		for _, b := range v {
			c := candidate{id: b.Id, title: b.Title}
			if b.MonsterName != nil && *b.MonsterName != b.Title {
				c.subtitle = *b.MonsterName
				c.body = append(c.body, *b.MonsterName)
			}
			for _, sec := range []string{"lore", "traits", "offense", "defenses"} {
				if t, ok := b.Record[sec]; ok {
					c.body = append(c.body, t)
				}
			}
			for _, n := range b.Notes {
				c.body = append(c.body, n.Body)
			}
			cs = append(cs, c)
		}
		collect(&out, api.HitBestiary, cs, q)
	}

	// The rules, for a viewer who may read them at all.
	if grant, _ := auth.GrantOf(ctx); grant.Kind == auth.GrantToken && !grant.Scopes.Holds(auth.RulesRead) {
		return api.SearchCampaign200JSONResponse(out), nil
	}
	if err := s.searchRules(ctx, &out, id, member.Role == db.MembershipRoleDm, q); err != nil {
		return nil, err
	}
	return api.SearchCampaign200JSONResponse(out), nil
}

// searchRules matches the rules as this table rules them: an SRD entry unless
// banned here, homebrew only when enabled here (codexRuling). Monsters never
// enter the codex, and are a DM's only.
func (s *Server) searchRules(ctx context.Context, out *api.SearchResults, campaignID [16]byte, isDM bool, q []rune) error {
	codex, ok, err := as[api.GetCodex200JSONResponse](s.GetCodex(ctx, api.GetCodexRequestObject{CampaignId: campaignID}))
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	status := make(map[[16]byte]db.CodexStatus, len(codex))
	for _, e := range codex {
		status[e.Content.Id] = db.CodexStatus(e.Status)
	}
	kinds := searchRulesKinds
	if isDM {
		kinds = append([]api.ContentKind{api.ContentKindMonster}, kinds...)
	}
	for _, kind := range kinds {
		entries, ok, err := as[api.ListRules200JSONResponse](s.ListRules(ctx, api.ListRulesRequestObject{Kind: kind}))
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		cs := make([]candidate, 0, len(entries))
		for _, e := range entries {
			if kind != api.ContentKindMonster {
				st, ruled := status[e.Id]
				if legal, _ := codexRuling(db.ContentSource(e.Source), st, ruled); !legal {
					continue
				}
			}
			c := candidate{id: e.Id, title: e.Name, body: []string{e.Summary}}
			if e.Source == api.Homebrew {
				c.subtitle = "Homebrew"
			}
			cs = append(cs, c)
		}
		collect(out, api.SearchKind(kind), cs, q)
	}
	return nil
}
