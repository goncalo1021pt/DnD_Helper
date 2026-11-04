package http

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
)

/*
The notice and the prop, read whole (#425). table_board shows a quest as a
line with its description cut short, and nothing at all showed a handout, which
is what a player asks an assistant about ("what did the Guildmistress's letter
say?"). Both tools read the strict handlers' own lists, so what is absent from
a player's list is absent here: a handout's picture is fetched only for an id
the list handed over, and that list is the veil — there is no second decision
to keep in step with the first.
*/

// reachNote says, for a DM, who a veiled thing reaches. A player's payload
// carries neither the flag nor the exceptions, so a player's note is empty.
func reachNote(visible *bool, overrides *[]api.VisibilityOverride) string {
	if visible == nil {
		return ""
	}
	var shown, held []string
	if overrides != nil {
		for _, o := range *overrides {
			if o.Visible {
				shown = append(shown, o.CharacterName)
			} else {
				held = append(held, o.CharacterName)
			}
		}
	}
	switch {
	case !*visible && len(shown) > 0:
		return "hidden from the party; shown to " + strings.Join(shown, ", ")
	case !*visible:
		return "hidden from the party"
	case len(held) > 0:
		return "seen by the party except " + strings.Join(held, ", ")
	}
	return ""
}

// --- quest ----------------------------------------------------------------

type questInput struct {
	Table string `json:"table,omitempty" jsonschema:"the table's id or name; may be left out when you sit at only one"`
	Quest string `json:"quest" jsonschema:"the notice's id or title (table_board lists them)"`
}

var questNaming = naming[api.Quest]{
	what: "quest",
	id:   func(q api.Quest) uuid.UUID { return q.Id },
	name: func(q api.Quest) string { return q.Title },
	label: func(q api.Quest) string {
		if q.Location != nil && *q.Location != "" {
			return fmt.Sprintf("%s · at %s", q.Status, *q.Location)
		}
		return string(q.Status)
	},
}

func addQuest(t *toolbox) {
	tool(t, "quest",
		"Quest",
		"One notice from the board in full: the whole description, its rewards, who claimed it and whether it has been paid out. table_board lists the notices with their ids.",
		func(ctx context.Context, in questInput) (string, error) {
			if strings.TrimSpace(in.Quest) == "" {
				return "", refuse("Which quest? table_board lists the notices.")
			}
			tb, err := t.s.tableRef(ctx, in.Table)
			if err != nil {
				return "", err
			}
			quests, ok, err := as[api.ListQuests200JSONResponse](t.s.ListQuests(ctx, api.ListQuestsRequestObject{CampaignId: tb.Campaign.Id}))
			if err != nil {
				return "", err
			}
			if !ok {
				return "", notReadable("That table")
			}
			q, err := pickOne(quests, in.Quest, questNaming)
			if err != nil {
				return "", err
			}
			return renderQuest(q), nil
		})
}

func renderQuest(q api.Quest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s (`%s`)\n\n%s, %s", q.Title, q.Id, q.Status, q.Difficulty)
	if q.Location != nil && *q.Location != "" {
		fmt.Fprintf(&b, " · at %s", *q.Location)
	}
	if q.Giver != nil && *q.Giver != "" {
		fmt.Fprintf(&b, " · from %s", *q.Giver)
	}
	b.WriteString("\n")
	if n := reachNote(q.VisibleToParty, q.Visibility); n != "" {
		fmt.Fprintf(&b, "\n_%s_\n", n)
	}
	if q.HiddenByLocation != nil && *q.HiddenByLocation {
		b.WriteString("\n_Its place is hidden from the party, so the notice is too._\n")
	}
	if d := strings.TrimSpace(q.Description); d != "" {
		fmt.Fprintf(&b, "\n%s\n", d)
	}

	if len(q.Rewards) > 0 {
		b.WriteString("\n## Rewards\n\n")
		payable := false
		for _, r := range q.Rewards {
			fmt.Fprintf(&b, "- %s", r.Label)
			if r.Qty != nil && *r.Qty > 1 {
				fmt.Fprintf(&b, " ×%d", *r.Qty)
			}
			if r.Value != nil && *r.Value != "" {
				fmt.Fprintf(&b, " (%s)", *r.Value)
			}
			if r.Payable != nil && *r.Payable {
				payable = true
				b.WriteString(" — can be paid out")
			}
			b.WriteString("\n")
		}
		switch {
		case q.PaidAt != nil:
			fmt.Fprintf(&b, "\nPaid out %s.\n", when(q.PaidAt))
		case payable && q.Status == api.QuestStatusCompleted:
			b.WriteString("\nNot paid out yet.\n")
		}
	}

	if len(q.Claims) > 0 {
		b.WriteString("\n## Claimed by\n\n")
		for _, c := range q.Claims {
			who := c.UserName
			if c.HeroName != nil && *c.HeroName != "" {
				who = fmt.Sprintf("%s (played by %s)", *c.HeroName, c.UserName)
			}
			ct := c.ClaimedAt
			fmt.Fprintf(&b, "- %s, %s\n", who, when(&ct))
		}
	}
	return b.String()
}

// --- handouts -------------------------------------------------------------

type handoutsInput struct {
	Table   string `json:"table,omitempty" jsonschema:"the table's id or name; may be left out when you sit at only one"`
	Handout string `json:"handout,omitempty" jsonschema:"optional: a handout's id or title, to see it — its picture comes with the answer. Leave out to list what you can see"`
}

var handoutNaming = naming[api.Handout]{
	what: "handout",
	id:   func(h api.Handout) uuid.UUID { return h.Id },
	name: func(h api.Handout) string { return h.Title },
	label: func(h api.Handout) string {
		ct := h.CreatedAt
		return "given " + when(&ct)
	},
}

func addHandouts(t *toolbox) {
	toolWith(t, "handouts",
		"Handouts",
		"The letters, maps and clues the DM has handed the party. With no name it lists the ones you can see; name one to read it — the answer carries the handout's picture, which is the letter itself.",
		func(ctx context.Context, in handoutsInput) ([]mcp.Content, error) {
			tb, err := t.s.tableRef(ctx, in.Table)
			if err != nil {
				return nil, err
			}
			list, ok, err := as[api.ListHandouts200JSONResponse](t.s.ListHandouts(ctx, api.ListHandoutsRequestObject{CampaignId: tb.Campaign.Id}))
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, notReadable("That table")
			}
			if strings.TrimSpace(in.Handout) == "" {
				return textContent(listHandouts(tb.Campaign.Name, list)), nil
			}
			h, err := pickOne(list, in.Handout, handoutNaming)
			if err != nil {
				return nil, err
			}
			return t.s.readHandout(ctx, h)
		})
}

func textContent(s string) []mcp.Content { return []mcp.Content{&mcp.TextContent{Text: s}} }

func listHandouts(table string, list []api.Handout) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Handouts at %s\n\n", table)
	if len(list) == 0 {
		b.WriteString("_Nothing has been handed to you yet._\n")
		return b.String()
	}
	for _, h := range list {
		ct := h.CreatedAt
		fmt.Fprintf(&b, "- **%s** (`%s`) — %s", h.Title, h.Id, when(&ct))
		if c := firstLine(h.Caption, 120); c != "" {
			fmt.Fprintf(&b, " · %s", c)
		}
		if n := reachNote(h.VisibleToParty, h.Visibility); n != "" {
			fmt.Fprintf(&b, " _(%s)_", n)
		}
		b.WriteString("\n")
	}
	b.WriteString("\n_Name one to read it; its picture comes with the answer._\n")
	return b.String()
}

// readHandout is the text of one handout and its picture. h came out of
// ListHandouts for this caller, so the veil has already been applied.
func (s *Server) readHandout(ctx context.Context, h api.Handout) ([]mcp.Content, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s (`%s`)\n", h.Title, h.Id)
	if n := reachNote(h.VisibleToParty, h.Visibility); n != "" {
		fmt.Fprintf(&b, "\n_%s_\n", n)
	}
	if c := strings.TrimSpace(h.Caption); c != "" {
		fmt.Fprintf(&b, "\n%s\n", c)
	}
	ct := h.CreatedAt
	fmt.Fprintf(&b, "\n_Given %s._\n", when(&ct))

	img, err := s.queries.GetHandoutImage(ctx, h.Id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notReadable("That handout")
		}
		return nil, err
	}
	data, mime, err := handoutImageForModel(img.Image, img.ContentType)
	if err != nil {
		if errors.Is(err, errImageTooBig) {
			b.WriteString("\n_The picture is too large to show here._\n")
			return textContent(b.String()), nil
		}
		return nil, err
	}
	return []mcp.Content{
		&mcp.TextContent{Text: b.String()},
		&mcp.ImageContent{Data: data, MIMEType: mime},
	}, nil
}
