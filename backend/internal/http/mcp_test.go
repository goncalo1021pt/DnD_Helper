package http

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
)

/*
The MCP door (#318), as far as it can be read without a database: who it
answers to, and which tools a grant is shown. What the tools *say* is read
through the strict handlers, and the veils those keep are driven end to end by
e2e/mcp.spec.ts.
*/

// toolsFor lists the tools a grant is shown, through a real client.
func toolsFor(t *testing.T, g auth.Grant) []string {
	t.Helper()
	ctx := context.Background()
	s := &Server{}
	st, ct := mcp.NewInMemoryTransports()
	if _, err := s.mcpServerFor(uuid.New(), g).Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	res, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, tl := range res.Tools {
		if tl.Annotations == nil || !tl.Annotations.ReadOnlyHint {
			t.Errorf("%s is not marked read-only", tl.Name)
		}
		names = append(names, tl.Name)
	}
	slices.Sort(names)
	return names
}

func TestMCPShowsOnlyTheToolsAGrantHolds(t *testing.T) {
	token := func(scopes ...auth.Scope) auth.Grant { return auth.Grant{Kind: auth.GrantToken, Scopes: scopes} }

	cases := []struct {
		name  string
		grant auth.Grant
		want  []string
	}{
		{"nothing", token(), []string{}},
		{"rules only", token(auth.RulesRead), []string{"lookup"}},
		{"a player's reading", token(auth.HeroesRead, auth.CampaignsRead, auth.RulesRead),
			[]string{"chronicle", "hero_sheet", "lookup", "my_heroes", "my_tables", "party", "table_board", "whats_known"}},
		{"a DM's reading", token(auth.HeroesRead, auth.CampaignsRun, auth.RulesRead),
			[]string{"chronicle", "den_search", "encounter_check", "hero_sheet", "lookup", "my_heroes", "my_tables", "party", "table_board", "whats_known"}},
		{"run without rules", token(auth.CampaignsRun), []string{"chronicle", "my_tables", "party", "table_board", "whats_known"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := toolsFor(t, c.grant); !slices.Equal(got, c.want) {
				t.Errorf("got %v, want %v", got, c.want)
			}
		})
	}
}

// Every tool the server knows is in the table that gates it, so a tool added
// without a scope declaration cannot slip in.
func TestEveryMCPToolDeclaresItsScopes(t *testing.T) {
	all := toolsFor(t, auth.Grant{Kind: auth.GrantToken, Scopes: auth.AllScopes})
	if len(all) != len(mcpTools) {
		t.Errorf("a full grant sees %d tools, the table has %d", len(all), len(mcpTools))
	}
	for _, def := range mcpTools {
		if len(def.scopes) == 0 {
			t.Errorf("%s declares no scope", def.name)
		}
		if !slices.Contains(all, def.name) {
			t.Errorf("%s registers under another name", def.name)
		}
	}
}

func TestMCPAnswersToATokenOnly(t *testing.T) {
	s := &Server{}
	call := func(ctx context.Context) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)).WithContext(ctx)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		rec := httptest.NewRecorder()
		s.ServeMCP().ServeHTTP(rec, req)
		return rec
	}
	signedIn := auth.WithUser(context.Background(), uuid.New())

	if rec := call(context.Background()); rec.Code != http.StatusUnauthorized || rec.Header().Get("WWW-Authenticate") == "" {
		t.Errorf("a stranger: got %d", rec.Code)
	}
	// A browser holding a session is the case that matters: a page it visits
	// must not be able to drive the tools as its person.
	if rec := call(auth.WithGrant(signedIn, auth.Grant{Kind: auth.GrantSession})); rec.Code != http.StatusUnauthorized {
		t.Errorf("a session: got %d", rec.Code)
	}
	if rec := call(auth.WithGrant(signedIn, auth.Grant{Kind: auth.GrantToken, Scopes: auth.Scopes{auth.RulesRead}})); rec.Code != http.StatusOK {
		t.Errorf("a token: got %d %s", rec.Code, rec.Body)
	}
}

func TestPickOneAsksRatherThanGuesses(t *testing.T) {
	type place struct {
		id   uuid.UUID
		name string
	}
	a, b, c := place{uuid.New(), "Barovia"}, place{uuid.New(), "Vallaki"}, place{uuid.New(), "Old Barovia Road"}
	all := []place{a, b, c}
	pick := func(ref string) (place, error) {
		return pickOne(all, ref, naming[place]{what: "place", id: func(p place) uuid.UUID { return p.id }, name: func(p place) string { return p.name }})
	}

	if got, err := pick("barovia"); err != nil || got != a {
		t.Errorf("an exact name wins over a longer one containing it: %v %v", got, err)
	}
	if got, err := pick("vall"); err != nil || got != b {
		t.Errorf("one partial match is taken: %v %v", got, err)
	}
	if got, err := pick(c.id.String()); err != nil || got != c {
		t.Errorf("an id is taken: %v %v", got, err)
	}
	if _, err := pick("a"); err == nil || !strings.Contains(err.Error(), "More than one") {
		t.Errorf("several partial matches are a question: %v", err)
	}
	if _, err := pick(uuid.NewString()); err == nil {
		t.Error("an unknown id is refused")
	}
	if _, err := pick("Strahd"); err == nil {
		t.Error("an unknown name is refused")
	}
}

// #420: an ambiguous name ranks like search, says what each candidate is,
// and stops listing before the list stops helping.
func TestPickOneRanksLabelsAndCaps(t *testing.T) {
	type entry struct {
		id         uuid.UUID
		name, kind string
	}
	mk := func(name, kind string) entry { return entry{uuid.New(), name, kind} }
	n := naming[entry]{
		what:  "entry",
		id:    func(e entry) uuid.UUID { return e.id },
		name:  func(e entry) string { return e.name },
		label: func(e entry) string { return e.kind },
	}

	boss, hob := mk("Goblin Boss", "monster"), mk("Hobgoblin Captain", "monster")
	if got, err := pickOne([]entry{hob, boss}, "goblin", n); err != nil || got != boss {
		t.Errorf("a name starting a word beats one buried in a word: %v %v", got, err)
	}

	spell, item := mk("Shield", "spell"), mk("Shield", "item")
	_, err := pickOne([]entry{spell, item, mk("Shield Master", "feat")}, "Shield", n)
	if err == nil || !strings.Contains(err.Error(), "Shield (spell · "+spell.id.String()+")") || !strings.Contains(err.Error(), "Shield (item · ") {
		t.Errorf("two exact names are asked about, each with its kind: %v", err)
	}
	if strings.Contains(err.Error(), "Shield Master") {
		t.Errorf("only the deciding rank is listed: %v", err)
	}

	if got, err := pickOne([]entry{mk("Café", "rule")}, "cafe", n); err != nil || got.name != "Café" {
		t.Errorf("accents fold as search folds them: %v %v", got, err)
	}

	many := []entry{}
	for i := 0; i < 40; i++ {
		many = append(many, mk(fmt.Sprintf("Bear %d", i), "monster"))
	}
	_, err = pickOne(many, "bear", n)
	if err == nil || !strings.Contains(err.Error(), "And 25 more.") || strings.Count(err.Error(), "Bear ") != pickMost {
		t.Errorf("a long list is cut at %d and says how many more: %v", pickMost, err)
	}

	long := strings.Repeat("a", 60000)
	if _, err := pickOne(many, long, n); err == nil || len(err.Error()) > 300 {
		t.Errorf("a refusal does not read a huge name back whole (%d bytes)", len(err.Error()))
	}
}

// #419: a feature inside a class answers a lookup, but a whole entry of the
// same name is preferred, and two features of one name are asked about by
// whose they are.
func TestCodexNamingFindsFeatures(t *testing.T) {
	fighter := api.RulesContent{Id: uuid.New(), Name: "Fighter", Kind: "class", Source: "srd", Data: map[string]any{
		"features": []any{
			map[string]any{"name": "Second Wind", "level": 1.0, "summary": "Regain 1d10 + level."},
			map[string]any{"name": "Channel Divinity", "level": 3.0},
		},
	}}
	paladin := api.RulesContent{Id: uuid.New(), Name: "Paladin", Kind: "class", Source: "srd", Data: map[string]any{
		"features": []any{map[string]any{"name": "Channel Divinity", "level": 3.0}},
	}}
	sentinel := api.RulesContent{Id: uuid.New(), Name: "Second Wind", Kind: "feat", Source: "srd"}
	pool := []codexHit{{entry: fighter}, {entry: paladin}}
	for _, r := range []api.RulesContent{fighter, paladin} {
		for _, f := range featuresOf(r) {
			pool = append(pool, codexHit{entry: r, feature: f})
		}
	}

	hit, err := pickOne(pool, "second wind", codexNaming)
	if err != nil || hit.feature == nil || hit.entry.Name != "Fighter" {
		t.Fatalf("Second Wind is found inside the Fighter: %+v %v", hit, err)
	}
	if out := renderFeature(hit); !strings.Contains(out, "feature of Fighter (class), level 1") || !strings.Contains(out, "Regain 1d10") {
		t.Errorf("a feature reads with where it comes from:\n%s", out)
	}

	if hit, err := pickOne(append(pool, codexHit{entry: sentinel}), "Second Wind", codexNaming); err != nil || hit.feature != nil {
		t.Errorf("a whole entry of the same name wins over a feature: %+v %v", hit, err)
	}

	_, err = pickOne(pool, "Channel Divinity", codexNaming)
	if err == nil || !strings.Contains(err.Error(), "Channel Divinity (feature of Fighter, level 3)") || !strings.Contains(err.Error(), "Channel Divinity (feature of Paladin, level 3)") || !strings.Contains(err.Error(), "from") {
		t.Errorf("two features of one name are asked about by whose they are, without the class's id: %v", err)
	}
}

// #422: a monster reads as one stat block — the scores as the books print
// them, no raw JSON, no field repeated above the block, no HTML entities.
func TestRenderEntryMonster(t *testing.T) {
	m := api.RulesContent{Name: "Goblin Boss", Kind: api.RulesContentKindMonster, Source: "srd", Data: map[string]any{
		"abilities":   map[string]any{"str": 10.0, "dex": 15.0, "con": 10.0, "int": 10.0, "wis": 8.0, "cha": 10.0},
		"ac":          17.0,
		"saves":       "",
		"cr":          "1 (XP 200; PB +2)",
		"crValue":     1.0,
		"description": "**AC** 17\n\n**Actions**\n\n**Scimitar.** Hit.\n\n&emsp;Second paragraph.",
	}}
	out := renderEntry(m)
	for _, want := range []string{"STR 10 (+0) · DEX 15 (+2)", "WIS 8 (-1)", "**Scimitar.**", "\nSecond paragraph."} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	for _, not := range []string{`{"`, "- **ac**", "saves", "&emsp;", "crValue"} {
		if strings.Contains(out, not) {
			t.Errorf("%q should not be in:\n%s", not, out)
		}
	}
}

func TestPlainValue(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{"", ""},
		{3.0, "3"},
		{0.25, "0.25"},
		{[]any{"Simple", "Martial"}, "Simple, Martial"},
		{[]any{0.0, 0.0, 0.0}, ""},
		{map[string]any{"ability": "CHA", "cantrips": []any{0.0, 0.0}, "prepared": []any{2.0, 3.0}}, "ability CHA; prepared 2, 3"},
		{map[string]any{"choose": 2.0, "from": []any{"Athletics", "Insight"}}, "choose 2; from Athletics, Insight"},
	}
	for _, c := range cases {
		if got := plainValue(c.in); got != c.want {
			t.Errorf("plainValue(%v) = %q, want %q", c.in, got, c.want)
		}
	}
	for n, want := range map[int]string{0: "0", 999: "999", 1000: "1,000", 75000: "75,000", 1234567: "1,234,567"} {
		if got := thousands(n); got != want {
			t.Errorf("thousands(%d) = %q, want %q", n, got, want)
		}
	}
}

// #421: a monster with no challenge rating is not the weakest in the Den.
func TestCRBeforeSortsNoneLast(t *testing.T) {
	cr := func(v float64) *float64 { return &v }
	list := []*float64{nil, cr(5), cr(0.25), nil, cr(0)}
	sort.SliceStable(list, func(i, j int) bool { return crBefore(list[i], list[j]) })
	got := []string{}
	for _, v := range list {
		got = append(got, crLabel(v))
	}
	if strings.Join(got, " ") != "0 1/4 5 ? ?" {
		t.Errorf("sorted %v", got)
	}
}

// #417: a tool call the ceiling refuses is answered inside the protocol, so
// the assistant reads "wait" rather than a broken connection; anything else
// keeps the plain 429.
func TestMCPRateLimitAnswersInProtocol(t *testing.T) {
	lim, _ := clocked(RateLimits{Token: 1}) // burst 2, an MCP call costs 2: one call
	s := &Server{limiter: lim}
	h := s.mcpRateLimit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) }))
	ctx := auth.WithGrant(auth.WithUser(context.Background(), uuid.New()), auth.Grant{Kind: auth.GrantToken, TokenID: uuid.New()})
	r := chi.NewRouter()
	r.Handle("/api/mcp", h)
	call := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body)).WithContext(ctx)
		req.RemoteAddr = "198.51.100.9:1"
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}
	toolCall := `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"my_tables","arguments":{}}}`
	if rec := call(toolCall); rec.Code != http.StatusTeapot {
		t.Fatalf("the first call passes, got %d", rec.Code)
	}

	rec := call(toolCall)
	if rec.Code != http.StatusOK || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("a refused tool call is a 200 carrying Retry-After, got %d", rec.Code)
	}
	var res struct {
		ID     int `json:"id"`
		Result struct {
			IsError bool `json:"isError"`
			Content []struct{ Text string }
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil || res.ID != 7 || !res.Result.IsError || len(res.Result.Content) != 1 || !strings.Contains(res.Result.Content[0].Text, "wait") {
		t.Fatalf("a tool result marked as an error, answering id 7 and saying to wait: %s", rec.Body)
	}

	if rec := call(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`); rec.Code != http.StatusTooManyRequests {
		t.Errorf("anything but a tool call keeps the plain 429, got %d", rec.Code)
	}
	if rec := call(`not json`); rec.Code != http.StatusTooManyRequests {
		t.Errorf("a body that is no call keeps the plain 429, got %d", rec.Code)
	}
}
