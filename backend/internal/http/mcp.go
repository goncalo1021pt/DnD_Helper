package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/version"
)

/*
A door for machines that ask questions (#318).

An AI holding a token could already read the whole API through the published
spec, but 202 operations is a long way round to "what does the party know
about Barovia". This is the short way: a handful of MCP tools shaped like the
questions a DM preparing a session (and a player between sessions) actually
asks, each answering in a few lines of markdown.

Four rules make it safe to hand to a model, and they are the whole design:

  - **The token is the door.** /api/mcp sits in the bearer group behind the
    rate limiter, and answers to a token only — a session cookie is refused, so
    no page a signed-in browser visits can drive it. The token's table
    restriction (Grant.Campaign) and its ceilings apply unchanged.
  - **A tool declares every scope its reads need**, and a token that lacks any
    of them never sees the tool: tools/list is built per request from what the
    grant holds. Because the tools call the strict handlers in-process, past
    scopeGate, the declaration is the gate — keep it the union of the scopes
    the called handlers declare in the spec.
  - **There is no second read path.** Every answer is composed from the strict
    handlers called with the caller's own identity, as /me/export is (#317), so
    a veil that holds on the screen holds here.
  - **Read only.** Chronicle lines, NPC notes and quest text are other people's
    words in the model's context; a tool that could write is what that text
    could steer. Writes, when they come, are drafts for the DM to publish.

The server is stateless — one MCP server is built per request, carrying only
the tools that request's grant holds — so there is no session to keep, and a
revoked token stops working on its very next call.
*/

// mcpSchemas caches the tools' input schemas, since a server is built per
// request and reflecting the same structs every time would be wasted work.
var mcpSchemas = mcp.NewSchemaCache()

const mcpInstructions = `Quest Board is a D&D campaign helper. These tools read it as the person whose token you hold: their tables (campaigns), their heroes, the rules codex, and what each table knows — quests, handouts, places, people, the chronicle. Everything is read-only, and you only ever see what that person could see in the app; a DM sees their own drafts and hidden things, marked as hidden.

Tables and heroes can be named by id or by name. Start with my_tables to see what is there.`

// refusal is an answer the model should read: a thing not found, an ambiguous
// name, a door this person may not open. Any other error is the server's own
// and is logged rather than shown.
type refusal struct{ msg string }

func (r refusal) Error() string { return r.msg }

func refuse(format string, args ...any) error { return refusal{fmt.Sprintf(format, args...)} }

// notReadable is what every non-200 from a handler becomes: a 403 and a 404
// read alike, as they do at the API's own doors.
func notReadable(what string) error {
	return refuse("%s was not found, or is not yours to read.", what)
}

// mcpTool is one tool: the scopes its reads need, and how it registers.
type mcpTool struct {
	name   string
	scopes []auth.Scope
	add    func(t *toolbox)
}

// toolbox is what a tool is registered against: the server under
// construction, and the caller it answers as.
type toolbox struct {
	s     *Server
	ms    *mcp.Server
	uid   uuid.UUID
	grant auth.Grant
}

// tool registers a read-only tool whose answer is markdown.
func tool[In any](t *toolbox, name, title, description string, run func(ctx context.Context, in In) (string, error)) {
	toolWith(t, name, title, description, func(ctx context.Context, in In) ([]mcp.Content, error) {
		text, err := run(ctx, in)
		if err != nil {
			return nil, err
		}
		return []mcp.Content{&mcp.TextContent{Text: text}}, nil
	})
}

// toolWith is tool for an answer that is more than text — a handout comes
// back as words and its picture (#425). The caller is put back on the context
// whatever the transport did with it, so every handler the tool calls sees
// exactly the identity and grant the request came with.
func toolWith[In any](t *toolbox, name, title, description string, run func(ctx context.Context, in In) ([]mcp.Content, error)) {
	mcp.AddTool(t.ms, &mcp.Tool{
		Name:        name,
		Title:       title,
		Description: description,
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true, OpenWorldHint: new(bool)},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
		ctx = auth.WithGrant(auth.WithUser(ctx, t.uid), t.grant)
		content, err := run(ctx, in)
		if err != nil {
			var r refusal
			if !errors.As(err, &r) {
				log.Printf("mcp: %s: %v", name, err)
				err = errors.New("something went wrong reading that; try again")
			}
			return nil, nil, err
		}
		return &mcp.CallToolResult{Content: content}, nil, nil
	})
}

// mcpServerFor builds the server one request talks to: only the tools the
// grant holds every scope of.
func (s *Server) mcpServerFor(uid uuid.UUID, grant auth.Grant) *mcp.Server {
	ms := mcp.NewServer(&mcp.Implementation{
		Name:    "questboard",
		Title:   "Quest Board",
		Version: version.Current,
	}, &mcp.ServerOptions{Instructions: mcpInstructions, SchemaCache: mcpSchemas})
	t := &toolbox{s: s, ms: ms, uid: uid, grant: grant}
	for _, def := range mcpTools {
		if grantHoldsAll(grant, def.scopes) {
			def.add(t)
		}
	}
	return ms
}

func grantHoldsAll(g auth.Grant, need []auth.Scope) bool {
	for _, sc := range need {
		if !g.Holds(sc) {
			return false
		}
	}
	return true
}

// ServeMCP is the door: a token, or nothing.
func (s *Server) ServeMCP() http.Handler {
	h := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		uid, _ := auth.UserID(r.Context())
		grant, _ := auth.GrantOf(r.Context())
		return s.mcpServerFor(uid, grant)
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, signedIn := auth.UserID(r.Context())
		grant, _ := auth.GrantOf(r.Context())
		if !signedIn || grant.Kind != auth.GrantToken {
			w.Header().Set("WWW-Authenticate", `Bearer realm="questboard"`)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(api.Error{Error: "the MCP server answers to an API token: send it as Authorization: Bearer qb_…"})
			return
		}
		h.ServeHTTP(w, r)
	})
}

// mcpRateLimit is the limiter for this door (#417). A tool call refused by
// the ceiling is answered inside the protocol — a tool result marked as an
// error, saying how long to wait — because a client reads a bare 429 as the
// connection failing, and the assistant tells its person the server is down
// instead of waiting four seconds. Anything else refused (initialize, a list,
// a body that is not one JSON-RPC call) keeps the plain 429.
func (s *Server) mcpRateLimit(next http.Handler) http.Handler {
	return s.limitWith(next, func(w http.ResponseWriter, r *http.Request, secs int) {
		id, ok := mcpToolCallID(r)
		if !ok {
			refuseTooMany(w, r, secs)
			return
		}
		text := fmt.Sprintf("Quest Board's rate limit for this token was reached: wait %d seconds, then try this call again.", secs)
		if secs == 1 {
			text = "Quest Board's rate limit for this token was reached: wait a second, then try this call again."
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      id,
			"result": map[string]any{
				"content": []map[string]string{{"type": "text", "text": text}},
				"isError": true,
			},
		})
	})
}

// mcpToolCallID reads a refused request's body for the one thing the answer
// needs: the id of a tools/call. The body is never handed on — the call was
// refused — so reading it costs nothing but the read.
func mcpToolCallID(r *http.Request) (json.RawMessage, bool) {
	if r.Method != http.MethodPost || r.Body == nil {
		return nil, false
	}
	var call struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&call); err != nil {
		return nil, false
	}
	if call.Method != "tools/call" || len(call.ID) == 0 || string(call.ID) == "null" {
		return nil, false
	}
	return call.ID, true
}

// --- naming things --------------------------------------------------------

// tableRef finds one of the caller's tables by id or by name. An empty ref is
// the caller's only table, when they have exactly one.
func (s *Server) tableRef(ctx context.Context, ref string) (api.CampaignMembership, error) {
	tables, ok, err := as[api.ListCampaigns200JSONResponse](s.ListCampaigns(ctx, api.ListCampaignsRequestObject{}))
	if err != nil {
		return api.CampaignMembership{}, err
	}
	if !ok || len(tables) == 0 {
		return api.CampaignMembership{}, refuse("You sit at no tables this token can reach.")
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		if len(tables) == 1 {
			return tables[0], nil
		}
		return api.CampaignMembership{}, refuse("Which table? You sit at %s.", listNames(tables, func(t api.CampaignMembership) string { return t.Campaign.Name }))
	}
	return pickOne(tables, ref, naming[api.CampaignMembership]{
		what: "table",
		id:   func(t api.CampaignMembership) uuid.UUID { return t.Campaign.Id },
		name: func(t api.CampaignMembership) string { return t.Campaign.Name },
		label: func(t api.CampaignMembership) string {
			if t.Role == api.Dm {
				return "you are DM"
			}
			return "you play"
		},
	})
}

// naming is how pickOne reads a candidate: its id and name, and the few words
// that tell two of the same name apart — "spell · srd", "Cleric 3 · at
// Invasion" — because a list of identical names with ids is a question nobody
// can answer (#420).
type naming[T any] struct {
	what  string
	id    func(T) uuid.UUID
	name  func(T) string
	label func(T) string // optional
	// prefer, when set, settles a tier holding both kinds of candidate: a
	// codex entry over a feature of the same name inside another entry.
	prefer func(T) bool
	// idless, when set, marks a candidate whose id would name something
	// else — a feature carries its class's id — so the list leaves it out.
	idless func(T) bool
	// narrow is what the refusal suggests beyond the id ("add kind").
	narrow string
}

// echo is a caller's words quoted back in a refusal, cut short: a model that
// sent sixty kilobytes as a name does not need them read back to it.
func echo(s string) string { return excerpt(strings.TrimSpace(s), 100) }

// pickMost is how many candidates an ambiguous name lists before it says how
// many more there are: past a dozen the list is no help, and "ea" matches
// three hundred codex entries.
const pickMost = 15

// pickOne resolves a reference against a list: an id; else the name, ranked
// the way search ranks it (#321) — the exact name (ignoring case and
// accents), else a name with a word starting with it, else a name containing
// it anywhere. The first rank with anything in it decides: one candidate is
// taken, several are a question back, never a guess.
func pickOne[T any](items []T, ref string, n naming[T]) (T, error) {
	var zero T
	if id, err := uuid.Parse(ref); err == nil {
		for _, it := range items {
			if n.id(it) == id {
				return it, nil
			}
		}
		return zero, notReadable("That " + n.what)
	}
	q := fold(strings.TrimSpace(ref)).runes
	var exact, word, within []T
	for _, it := range items {
		name := fold(n.name(it))
		switch {
		case string(name.runes) == string(q):
			exact = append(exact, it)
		case name.wordIndex(q) >= 0:
			word = append(word, it)
		case name.index(q) >= 0:
			within = append(within, it)
		}
	}
	for _, set := range [][]T{exact, word, within} {
		if n.prefer != nil {
			var preferred []T
			for _, it := range set {
				if n.prefer(it) {
					preferred = append(preferred, it)
				}
			}
			if len(preferred) > 0 {
				set = preferred
			}
		}
		switch {
		case len(set) == 1:
			return set[0], nil
		case len(set) > 1:
			return zero, refuse("More than one %s matches %q: %s", n.what, echo(ref), n.list(set))
		}
	}
	return zero, refuse("No %s matches %q.", n.what, echo(ref))
}

// list writes the candidates of an ambiguous name, at most pickMost of them,
// and what to do next.
func (n naming[T]) list(set []T) string {
	parts := make([]string, 0, min(len(set), pickMost))
	for _, it := range set[:min(len(set), pickMost)] {
		tags := []string{}
		if n.label != nil {
			if l := n.label(it); l != "" {
				tags = append(tags, l)
			}
		}
		if n.idless == nil || !n.idless(it) {
			tags = append(tags, n.id(it).String())
		}
		tag := strings.Join(tags, " · ")
		parts = append(parts, fmt.Sprintf("%s (%s)", n.name(it), tag))
	}
	out := strings.Join(parts, "; ") + "."
	if more := len(set) - pickMost; more > 0 {
		out += fmt.Sprintf(" And %d more.", more)
	}
	out += " Use the id"
	if n.narrow != "" {
		out += ", " + n.narrow
	} else if len(set) > pickMost {
		out += ", or a longer name"
	}
	return out + "."
}

func listNames[T any](items []T, nameOf func(T) string) string {
	names := make([]string, 0, len(items))
	for _, it := range items {
		names = append(names, nameOf(it))
	}
	return strings.Join(names, ", ")
}
