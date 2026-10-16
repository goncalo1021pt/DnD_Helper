package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

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
		return pickOne(all, ref, "place", func(p place) uuid.UUID { return p.id }, func(p place) string { return p.name })
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
