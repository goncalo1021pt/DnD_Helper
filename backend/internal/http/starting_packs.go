package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Starting gear is the DM's to hand out (#390).

The Forge used to give every hero their class's kit and their background's
whether anyone wanted it or not, and the kit mostly failed to become items:
twenty of its names matched nothing in the armory, the equipment packs did not
exist, and "shortbow with 20 arrows" was one row nobody could equip. Now the
Forge gives nothing, and the DM hands a hero their start through the gift door
(#394) — the class's A or B, the background's kit or its 50 gp, or a pack the
table wrote.

This file reads those options out of content and matches every line against
the armory, so a kit arrives as real items. A pack — an equipment pack, an
item that declares `contents` — always arrives as what is in it, at every door
(this one, the DM's plain Give, and the shop): it is a shopping convenience in
the books, a bundle you buy and then carry the pieces of.
*/

// A kit line as content writes it. `Choose` makes it a choice the DM settles
// when giving ("a musical instrument of your choice"): Name is then only the
// label, and the options are what it may become.
type kitItem struct {
	Name   string   `json:"name"`
	Qty    int      `json:"qty"`
	Choose []string `json:"choose"`
}

// A class's or a background's starting option: "A", "B", "C". Gold is written
// in gp, as the books write it, and converted to the table's money.
type kitOption struct {
	Label string    `json:"label"`
	Items []kitItem `json:"items"`
	Gold  int       `json:"gold"`
}

var wordQty = map[string]int{
	"two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
	"seven": 7, "eight": 8, "nine": 9, "ten": 10,
}

var (
	goldToken = regexp.MustCompile(`^(\d+)\s*gp$`)
	qtyToken  = regexp.MustCompile(`^(\d+)\s+(.+)$`)
	// "shortbow with 20 arrows": a thing and the ammunition that comes with it.
	withToken = regexp.MustCompile(`(?i)^(.+?)\s+with\s+(\d+)\s+(.+)$`)
)

// parseEquipmentLine turns a background's prose kit ("Two daggers, thieves'
// tools, 16 gp") into lines plus gold. It is the fallback for content that has
// no structured `startingEquipment` — homebrew, mostly.
func parseEquipmentLine(line string) (items []kitItem, gold int) {
	for _, tok := range strings.Split(line, ",") {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		if m := goldToken.FindStringSubmatch(strings.ToLower(tok)); m != nil {
			g, _ := strconv.Atoi(m[1])
			gold += g
			continue
		}
		if m := withToken.FindStringSubmatch(tok); m != nil {
			n, _ := strconv.Atoi(m[2])
			items = append(items, kitItem{Name: m[1], Qty: 1}, kitItem{Name: m[3], Qty: n})
			continue
		}
		qty := 1
		if m := qtyToken.FindStringSubmatch(tok); m != nil {
			qty, _ = strconv.Atoi(m[1])
			tok = m[2]
		} else if fields := strings.SplitN(tok, " ", 2); len(fields) == 2 {
			if n, ok := wordQty[strings.ToLower(fields[0])]; ok {
				qty, tok = n, fields[1]
			}
		}
		items = append(items, kitItem{Name: tok, Qty: qty})
	}
	return items, gold
}

// itemLibrary is the armory a kit is matched against, by lowercased name.
type itemLibrary map[string]db.ListContentByKindRow

// itemLibraryFor reads the armory as one person sees it: the SRD, their own
// homebrew, and homebrew their tables admit. The SRD wins a name clash, so a
// homebrew shadow never replaces the entry a book kit meant.
func (s *Server) itemLibraryFor(ctx context.Context, uid uuid.UUID) (itemLibrary, error) {
	return s.libraryByNameFor(ctx, uid, db.ContentKindItem)
}

// find matches a kit name, then a plural or "armor" variant of it. `bundle` is
// the quantity a line asked for: "Arrow" ×20 finds "Arrows (20)" and answers 1,
// since the library sells arrows by the twenty.
func (l itemLibrary) find(name string, bundle int) (row db.ListContentByKindRow, qty int, ok bool) {
	lower := strings.ToLower(strings.TrimSpace(name))
	for _, candidate := range []string{
		lower,
		strings.TrimSuffix(lower, " armor"),
		lower + " armor",
		strings.TrimSuffix(lower, "s"),
	} {
		if row, ok := l[candidate]; ok {
			return row, bundle, true
		}
	}
	if bundle > 1 {
		for _, candidate := range []string{
			fmt.Sprintf("%ss (%d)", lower, bundle),
			fmt.Sprintf("%s (%d)", lower, bundle),
		} {
			if row, ok := l[candidate]; ok {
				return row, 1, true
			}
		}
	}
	return db.ListContentByKindRow{}, bundle, false
}

// packContent is one line of an item's `contents`.
type packContent struct {
	Name string `json:"name"`
	Qty  int    `json:"qty"`
}

// contentsOf reads what a pack item holds; empty for an ordinary item.
func contentsOf(data []byte) []packContent {
	var d struct {
		Contents []packContent `json:"contents"`
	}
	if json.Unmarshal(data, &d) != nil {
		return nil
	}
	return d.Contents
}

// unpackedLines is what an equipment pack becomes: its contents, each matched
// to the armory by exact name (a content name must be an armory name, and a
// test holds the SRD to it) or written in when the library lacks it, times
// however many packs were taken.
func unpackedLines(lib itemLibrary, contents []packContent, times int32) []giftLine {
	out := make([]giftLine, 0, len(contents))
	for _, c := range contents {
		qty := int32(c.Qty) * times
		if qty < 1 {
			qty = 1
		}
		if qty > 999 {
			qty = 999
		}
		line := giftLine{name: c.Name, qty: qty}
		if row, ok := lib[strings.ToLower(c.Name)]; ok {
			line.contentID, line.name = pgUUID(row.ID), row.Name
		}
		out = append(out, line)
	}
	return out
}

// kitOptionsOf reads the options a class or a background offers. A background
// with no structured kit falls back to its prose as option A, with the books'
// 50 gp as B.
func kitOptionsOf(data []byte, fallbackProse bool) []kitOption {
	var d struct {
		Starting  []kitOption `json:"startingEquipment"`
		Equipment string      `json:"equipment"`
	}
	if json.Unmarshal(data, &d) != nil {
		return nil
	}
	if len(d.Starting) > 0 || !fallbackProse || strings.TrimSpace(d.Equipment) == "" {
		return d.Starting
	}
	items, gold := parseEquipmentLine(d.Equipment)
	return []kitOption{{Label: "A", Items: items, Gold: gold}, {Label: "B", Gold: 50}}
}

// packOption matches one option's lines against the armory for the API.
func packOption(opt kitOption, lib itemLibrary, ladder Coinage) api.StartingPackOption {
	out := api.StartingPackOption{Label: opt.Label, Lines: []api.PackLine{}}
	for _, it := range opt.Items {
		qty := it.Qty
		if qty < 1 {
			qty = 1
		}
		line := api.PackLine{Name: it.Name, Qty: qty}
		if len(it.Choose) > 0 {
			choices := make([]api.PackChoice, 0, len(it.Choose))
			for _, name := range it.Choose {
				c := api.PackChoice{Name: name}
				if row, _, ok := lib.find(name, 1); ok {
					id := openapi_types.UUID(row.ID)
					c.ContentId, c.Name = &id, row.Name
				}
				choices = append(choices, c)
			}
			line.Choose = &choices
		} else if row, q, ok := lib.find(it.Name, qty); ok {
			id := openapi_types.UUID(row.ID)
			line.ContentId, line.Name, line.Qty = &id, row.Name, q
		}
		out.Lines = append(out.Lines, line)
	}
	if opt.Gold > 0 {
		coin := formatCoins(int64(opt.Gold)*goldWorth(ladder), ladder)
		out.Coin = &coin
	}
	return out
}

// GetStartingPacks answers what a DM may hand this hero as starting gear.
// 404 to anyone who is not the DM of the table the hero sits at, so the
// route is no way to learn that a hero exists or where.
func (s *Server) GetStartingPacks(ctx context.Context, request api.GetStartingPacksRequestObject) (api.GetStartingPacksResponseObject, error) {
	hero, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetStartingPacks404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	campaignID, seated := seatedCampaign(hero)
	if !seated {
		return api.GetStartingPacks404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetStartingPacks401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetStartingPacks404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		default:
			return nil, err
		}
	}
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	ladder := coinageOf(campaign.Coinage)
	lib, err := s.itemLibraryFor(ctx, member.UserID)
	if err != nil {
		return nil, err
	}

	out := api.StartingPacks{
		ClassName:         hero.Class,
		ClassOptions:      []api.StartingPackOption{},
		BackgroundOptions: []api.StartingPackOption{},
		Custom:            []api.CustomPack{},
	}
	// Only the class they STARTED as: the 2024 rules give a second class no gear.
	if hero.ClassID.Valid {
		if class, err := s.queries.GetContent(ctx, uuid.UUID(hero.ClassID.Bytes)); err == nil {
			out.ClassName = class.Name
			for _, o := range kitOptionsOf(class.Data, false) {
				out.ClassOptions = append(out.ClassOptions, packOption(o, lib, ladder))
			}
		}
	}
	if hero.BackgroundID.Valid {
		if bg, err := s.queries.GetContent(ctx, uuid.UUID(hero.BackgroundID.Bytes)); err == nil {
			name := bg.Name
			out.BackgroundName = &name
			for _, o := range kitOptionsOf(bg.Data, true) {
				out.BackgroundOptions = append(out.BackgroundOptions, packOption(o, lib, ladder))
			}
		}
	}
	packs, err := s.queries.ListCampaignPacks(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	for _, p := range packs {
		out.Custom = append(out.Custom, toAPICustomPack(p))
	}
	if hero.StartingPackAt.Valid {
		at := hero.StartingPackAt.Time
		out.GivenAt = &at
	}
	return api.GetStartingPacks200JSONResponse(out), nil
}

// --- the table's own packs --------------------------------------------------

type storedPackItem struct {
	ContentID *uuid.UUID `json:"contentId,omitempty"`
	Name      string     `json:"name"`
	Qty       int        `json:"qty"`
}

func toAPICustomPack(p db.CampaignPack) api.CustomPack {
	var stored []storedPackItem
	_ = json.Unmarshal(p.Items, &stored)
	items := make([]api.GiftItem, 0, len(stored))
	for _, it := range stored {
		qty := it.Qty
		name := it.Name
		g := api.GiftItem{Qty: &qty}
		if it.ContentID != nil {
			id := openapi_types.UUID(*it.ContentID)
			g.ContentId = &id
		}
		g.Name = &name
		items = append(items, g)
	}
	out := api.CustomPack{Id: p.ID, Name: p.Name, Items: items}
	if strings.TrimSpace(p.Coin) != "" {
		coin := p.Coin
		out.Coin = &coin
	}
	return out
}

// checkedPack validates a pack the DM wrote, the way a gift is validated —
// the same rules about what may be named and what coin may be — and answers
// what to store. The name is always kept beside a library id, so a struck
// library entry degrades to a written-in row.
func (s *Server) checkedPack(ctx context.Context, campaignID, dm uuid.UUID, in *api.CustomPackInput, existing uuid.UUID) (string, []byte, string, string, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 60 {
		return "", nil, "", "a pack's name must be between 1 and 60 characters", nil
	}
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return "", nil, "", "", err
	}
	ladder := coinageOf(campaign.Coinage)

	var stored []storedPackItem
	if in.Items != nil {
		for _, it := range *in.Items {
			qty := 1
			if it.Qty != nil {
				qty = *it.Qty
			}
			if qty < 1 || qty > 999 {
				return "", nil, "", "an item's quantity must be between 1 and 999", nil
			}
			switch {
			case it.ContentId != nil:
				row, err := s.fetchVisibleContent(ctx, uuid.UUID(*it.ContentId), db.ContentKindItem, dm)
				if err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return "", nil, "", "unknown item", nil
					}
					return "", nil, "", "that choice is not an item", nil
				}
				id := row.ID
				stored = append(stored, storedPackItem{ContentID: &id, Name: row.Name, Qty: qty})
			case it.Name != nil:
				n := strings.TrimSpace(*it.Name)
				if n == "" || len([]rune(n)) > 80 {
					return "", nil, "", "an item name must be between 1 and 80 characters", nil
				}
				if strings.EqualFold(n, ladder.purseName()) {
					return "", nil, "", "give coin with the coin field, not as an item", nil
				}
				stored = append(stored, storedPackItem{Name: n, Qty: qty})
			default:
				return "", nil, "", "an item needs a library entry or a name", nil
			}
		}
	}
	coin := ""
	if in.Coin != nil {
		coin = strings.TrimSpace(*in.Coin)
		if _, msg := parseGiftCoin(coin, ladder); msg != "" {
			return "", nil, "", msg, nil
		}
	}
	if len(stored) == 0 && coin == "" {
		return "", nil, "", "a pack needs an item or some coin", nil
	}
	// One name per table, so the dialog's list reads unambiguously.
	others, err := s.queries.ListCampaignPacks(ctx, campaignID)
	if err != nil {
		return "", nil, "", "", err
	}
	for _, o := range others {
		if o.ID != existing && strings.EqualFold(o.Name, name) {
			return "", nil, "", "this table already has a pack called " + o.Name, nil
		}
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return "", nil, "", "", err
	}
	return name, raw, coin, "", nil
}

func (s *Server) ListCampaignPacks(ctx context.Context, request api.ListCampaignPacksRequestObject) (api.ListCampaignPacksResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListCampaignPacks401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListCampaignPacks403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	rows, err := s.queries.ListCampaignPacks(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out := make([]api.CustomPack, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPICustomPack(r))
	}
	return api.ListCampaignPacks200JSONResponse(out), nil
}

func (s *Server) CreateCampaignPack(ctx context.Context, request api.CreateCampaignPackRequestObject) (api.CreateCampaignPackResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateCampaignPack401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateCampaignPack403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.CreateCampaignPackResponseObject, error) {
		return api.CreateCampaignPack400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a pack body is required")
	}
	name, items, coin, msg, err := s.checkedPack(ctx, campaignID, member.UserID, request.Body, uuid.Nil)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return badRequest(msg)
	}
	row, err := s.queries.CreateCampaignPack(ctx, db.CreateCampaignPackParams{
		CampaignID: campaignID, Name: name, Items: items, Coin: coin,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateCampaignPack201JSONResponse(toAPICustomPack(row)), nil
}

func (s *Server) UpdateCampaignPack(ctx context.Context, request api.UpdateCampaignPackRequestObject) (api.UpdateCampaignPackResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateCampaignPack401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateCampaignPack403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.UpdateCampaignPackResponseObject, error) {
		return api.UpdateCampaignPack400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a pack body is required")
	}
	if _, err := s.queries.GetCampaignPack(ctx, db.GetCampaignPackParams{ID: request.PackId, CampaignID: campaignID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateCampaignPack404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	name, items, coin, msg, err := s.checkedPack(ctx, campaignID, member.UserID, request.Body, request.PackId)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return badRequest(msg)
	}
	row, err := s.queries.UpdateCampaignPack(ctx, db.UpdateCampaignPackParams{
		ID: request.PackId, CampaignID: campaignID, Name: name, Items: items, Coin: coin,
	})
	if err != nil {
		return nil, err
	}
	return api.UpdateCampaignPack200JSONResponse(toAPICustomPack(row)), nil
}

func (s *Server) DeleteCampaignPack(ctx context.Context, request api.DeleteCampaignPackRequestObject) (api.DeleteCampaignPackResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteCampaignPack401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteCampaignPack403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if _, err := s.queries.GetCampaignPack(ctx, db.GetCampaignPackParams{ID: request.PackId, CampaignID: campaignID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteCampaignPack404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if err := s.queries.DeleteCampaignPack(ctx, db.DeleteCampaignPackParams{ID: request.PackId, CampaignID: campaignID}); err != nil {
		return nil, err
	}
	return api.DeleteCampaignPack204Response{}, nil
}

// validatePackContents checks an item's optional `contents` (#390): the lines
// an equipment pack becomes. One level only — a pack of packs would unpack
// into a pack nobody unpacks.
func validatePackContents(data map[string]interface{}) string {
	raw, present := data["contents"]
	if !present || raw == nil {
		return ""
	}
	list, ok := raw.([]interface{})
	if !ok || len(list) == 0 || len(list) > 30 {
		return "contents must be a list of 1 to 30 lines"
	}
	for _, item := range list {
		line, ok := item.(map[string]interface{})
		if !ok {
			return "each contents line must be an object with a name and a qty"
		}
		name, _ := getStr(line, "name")
		if strings.TrimSpace(name) == "" || len([]rune(name)) > 80 {
			return "each contents line needs a name of 1 to 80 characters"
		}
		if q, ok := getNum(line, "qty"); !ok || q < 1 || q > 999 {
			return "contents line " + name + " needs a qty between 1 and 999"
		}
	}
	return ""
}

// validateStartingEquipment checks a class's or a background's
// `startingEquipment`: options with a label, lines (a fixed item, or a choose-one
// line listing what it may become) and gold in gp.
func validateStartingEquipment(data map[string]interface{}) string {
	raw, present := data["startingEquipment"]
	if !present || raw == nil {
		return ""
	}
	options, ok := raw.([]interface{})
	if !ok || len(options) == 0 || len(options) > 8 {
		return "startingEquipment must be a list of 1 to 8 options"
	}
	seen := map[string]bool{}
	for _, o := range options {
		opt, ok := o.(map[string]interface{})
		if !ok {
			return "each starting option must be an object"
		}
		label, _ := getStr(opt, "label")
		label = strings.TrimSpace(label)
		if label == "" || len([]rune(label)) > 20 {
			return "each starting option needs a label of 1 to 20 characters"
		}
		if seen[strings.ToLower(label)] {
			return "two starting options are both called " + label
		}
		seen[strings.ToLower(label)] = true
		if g, ok := getNum(opt, "gold"); ok && (g < 0 || g > 100000) {
			return "option " + label + " has gold outside 0 to 100,000"
		}
		items, _ := opt["items"].([]interface{})
		if len(items) > 30 {
			return "option " + label + " lists more than 30 items"
		}
		for _, it := range items {
			line, ok := it.(map[string]interface{})
			if !ok {
				return "option " + label + " has a line that is not an object"
			}
			name, _ := getStr(line, "name")
			if strings.TrimSpace(name) == "" || len([]rune(name)) > 80 {
				return "option " + label + " has a line without a name"
			}
			if q, ok := getNum(line, "qty"); ok && (q < 1 || q > 999) {
				return "option " + label + ": " + name + " needs a qty between 1 and 999"
			}
			if choose, present := line["choose"]; present && choose != nil {
				names, ok := getStrSlice(line, "choose")
				if !ok || len(names) < 2 || len(names) > 40 {
					return "option " + label + ": " + name + " must choose from 2 to 40 names"
				}
			}
		}
	}
	return ""
}
