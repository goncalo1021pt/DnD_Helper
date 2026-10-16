package http

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
The DM gives (#394).

Until now nothing a DM could do in the app put anything in a hero's pack: the
sheet was read-only to them, quest rewards were words on a notice, and the only
workarounds were a raw POST to the inventory or a shop line priced at nothing.
This is the one door: a DM names seated heroes, and items and coin arrive —
stacking where a row matches, making a purse where there is none.

It is also the door the rest stands on. A starting pack (#390) is a gift with a
name, and a quest's reward (#395) pays out as one, so the rules about what may
land in a pack, and what is said about it, live here once.
*/

// A purse past this is a typo, and the column is an int32 besides.
const purseCeiling = 2_000_000_000

// giftLine is one resolved line of a gift: what to add, and how it reads.
type giftLine struct {
	contentID pgtype.UUID
	name      string
	qty       int32
	// stock is what a pack becomes (#390): an equipment pack is named in the
	// chronicle and the event as itself, and arrives as its contents.
	stock []giftLine
}

// toStock is what actually lands in the pack: the line itself, or what it
// unpacks to.
func (l giftLine) toStock() []giftLine {
	if len(l.stock) > 0 {
		return l.stock
	}
	return []giftLine{l}
}

func (l giftLine) text() string {
	if l.qty > 1 {
		return fmt.Sprintf("%d× %s", l.qty, l.name)
	}
	return l.name
}

// coinPart is one "number and a coin" in an amount — a thousands comma belongs
// to its number, so the parts are found rather than split off at commas.
var coinPart = regexp.MustCompile(`(?i)\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?\p{L}{1,16}`)

// parseGiftCoin reads "50 gp" or "2 gp, 5 sp" into base units. Zero or blank is
// no coin; anything the till cannot read — prose, a coin this table does not
// use, a stray word between the parts — is refused rather than guessed at.
func parseGiftCoin(text string, ladder Coinage) (int64, string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, ""
	}
	try := fmt.Sprintf("try \"50 %s\"", ladder.Coins[ladder.goldRung()].Abbrev)
	var total int64
	rest := text
	spans := coinPart.FindAllStringIndex(text, -1)
	if len(spans) == 0 {
		return 0, fmt.Sprintf("%q is not an amount in this table's coin — %s", text, try)
	}
	at := 0
	for _, span := range spans {
		// Only separators may stand between the parts.
		if strings.Trim(text[at:span[0]], " ,;+&") != "" && !strings.EqualFold(strings.TrimSpace(text[at:span[0]]), "and") {
			return 0, fmt.Sprintf("%q is not an amount in this table's coin — %s", text, try)
		}
		base, ok := priceBase(text[span[0]:span[1]], ladder)
		if !ok {
			return 0, fmt.Sprintf("%q is not an amount in this table's coin — %s", text[span[0]:span[1]], try)
		}
		total += base
		at = span[1]
	}
	rest = text[at:]
	if strings.Trim(rest, " ,;+&") != "" {
		return 0, fmt.Sprintf("%q is not an amount in this table's coin — %s", text, try)
	}
	if total > purseCeiling {
		return 0, "that is more coin than a purse can hold"
	}
	return total, ""
}

// GiveGift puts items and coin in the packs of seated heroes (DM only).
func (s *Server) GiveGift(ctx context.Context, request api.GiveGiftRequestObject) (api.GiveGiftResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GiveGift401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GiveGift403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.GiveGiftResponseObject, error) {
		return api.GiveGift400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a gift body is required")
	}
	body := request.Body

	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	ladder := coinageOf(campaign.Coinage)

	coin := int64(0)
	if body.Coin != nil {
		var msg string
		if coin, msg = parseGiftCoin(*body.Coin, ladder); msg != "" {
			return badRequest(msg)
		}
	}

	// The lines: a library item, or a written-in name. Homebrew answers to the
	// table's codex — the DM giving it is not the same as the world admitting it.
	var lines []giftLine
	var contentIDs []uuid.UUID
	var lib itemLibrary
	if body.Items != nil {
		for _, it := range *body.Items {
			qty := int32(1)
			if it.Qty != nil {
				if *it.Qty < 1 || *it.Qty > 999 {
					return badRequest("an item's quantity must be between 1 and 999")
				}
				qty = int32(*it.Qty)
			}
			var cid *uuid.UUID
			if it.ContentId != nil {
				id := uuid.UUID(*it.ContentId)
				cid = &id
			}
			line, msg, err := s.giftLineFor(ctx, member.UserID, ladder, cid, it.Name, qty, &lib)
			if err != nil {
				return nil, err
			}
			if msg != "" {
				return badRequest(msg)
			}
			if line.contentID.Valid {
				contentIDs = append(contentIDs, uuid.UUID(line.contentID.Bytes))
			}
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 && coin == 0 {
		return badRequest("a gift needs an item or some coin")
	}
	blockers, err := s.codexBlockers(ctx, campaignID, contentIDs)
	if err != nil {
		return nil, err
	}
	if len(blockers) > 0 {
		return badRequest(blockers[0].row.Name + " is not admitted by this table's codex — rule on it first")
	}

	// The heroes: seated here, each named once.
	rows, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	seated := map[uuid.UUID]bool{}
	for _, row := range rows {
		seated[row.ID] = true
	}
	var targets []uuid.UUID
	picked := map[uuid.UUID]bool{}
	for _, id := range body.HeroIds {
		hero := uuid.UUID(id)
		if !seated[hero] {
			return badRequest("a chosen hero is not seated at this table")
		}
		if !picked[hero] {
			picked[hero] = true
			targets = append(targets, hero)
		}
	}

	// Every hero's pack changes together or not at all.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	for _, hero := range targets {
		var stock []giftLine
		for _, line := range lines {
			stock = append(stock, line.toStock()...)
		}
		msg, err := fillPack(ctx, qtx, hero, stock, coin, ladder)
		if err != nil {
			return nil, err
		}
		if msg != "" {
			return badRequest(msg)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// A starting pack stamps its heroes, so the dialog can warn the next time.
	pack := ""
	if body.StartingPack != nil {
		pack = strings.TrimSpace(*body.StartingPack)
		if len([]rune(pack)) > 80 {
			pack = string([]rune(pack)[:80])
		}
	}
	if pack != "" {
		if err := s.queries.MarkStartingPack(ctx, targets); err != nil {
			return nil, err
		}
	}

	// What was said and who is told.
	announce := body.Announce == nil || *body.Announce
	s.sayGift(ctx, campaignID, member.UserID, targets, rows, lines, coin, ladder, body.Note, announce, pack)

	out := make([]api.Character, 0, len(targets))
	for _, hero := range targets {
		c, err := s.queries.GetCharacter(ctx, hero)
		if err != nil {
			return nil, err
		}
		name, err := s.ownerName(ctx, c.OwnerUserID)
		if err != nil {
			return nil, err
		}
		out = append(out, toAPICharacterWithClass(c, name, member.UserID, s.classDataFor(ctx, c), s.classesFor(ctx, c)))
	}
	return api.GiveGift200JSONResponse(out), nil
}

// sayGift writes the chronicle line and tells each hero's owner. The line is
// the table's to read unless the DM kept it quiet; the owner is always told.
func (s *Server) sayGift(
	ctx context.Context, campaignID, actor uuid.UUID, targets []uuid.UUID,
	rows []db.ListCharactersByCampaignRow, lines []giftLine, coin int64, ladder Coinage,
	note *string, announce bool, pack string,
) {
	names := map[uuid.UUID]string{}
	owners := map[uuid.UUID]uuid.UUID{}
	for _, r := range rows {
		names[r.ID] = r.Name
		owners[r.ID] = r.OwnerUserID
	}
	goods := make([]string, 0, len(lines)+1)
	items := make([]struct {
		Name string `json:"name"`
		Qty  int    `json:"qty"`
	}, 0, len(lines))
	for _, l := range lines {
		goods = append(goods, l.text())
		items = append(items, struct {
			Name string `json:"name"`
			Qty  int    `json:"qty"`
		}{l.name, int(l.qty)})
	}
	var coinText *string
	if coin > 0 {
		t := formatCoins(coin, ladder)
		coinText = &t
		goods = append(goods, t)
	}
	var noteText *string
	if note != nil && strings.TrimSpace(*note) != "" {
		n := strings.TrimSpace(*note)
		noteText = &n
	}

	if announce {
		heroNames := make([]string, 0, len(targets))
		for _, t := range targets {
			heroNames = append(heroNames, names[t])
		}
		line := fmt.Sprintf("The DM gives %s %s", joinNames(heroNames), joinGoods(goods))
		if pack != "" {
			line = fmt.Sprintf("The DM gives %s their starting pack (%s): %s", joinNames(heroNames), pack, joinGoods(goods))
		}
		if noteText != nil {
			line += " — " + *noteText
		}
		s.logEvent(ctx, campaignID, actor, "gift", line)
	}
	s.publish(campaignID, live.TopicParty)

	for _, t := range targets {
		aud, audErr := s.ownerAndDMs(ctx, campaignID, owners[t])
		s.emitPublic(ctx, campaignID, events.HeroGifted, aud, audErr, announce, api.HeroGiftEventPayload{
			HeroId: openapi_types.UUID(t), HeroName: names[t], Items: items, Coin: coinText, Note: noteText,
		})
	}
}

// giftLineFor resolves one thing to give: a library item (a pack arrives as
// what is in it, at every door — #390) or a written-in name. A non-empty
// message is the reason it cannot be given. `lib` is read lazily and kept, so a
// gift of many lines reads the armory once. Whether the codex admits a homebrew
// item is the caller's to ask of `codexBlockers`, with the ids it collects.
func (s *Server) giftLineFor(
	ctx context.Context, userID uuid.UUID, ladder Coinage,
	contentID *uuid.UUID, name *string, qty int32, lib *itemLibrary,
) (giftLine, string, error) {
	switch {
	case contentID != nil:
		row, err := s.fetchVisibleContent(ctx, *contentID, db.ContentKindItem, userID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return giftLine{}, "unknown item", nil
			}
			return giftLine{}, "that choice is not an item", nil
		}
		line := giftLine{contentID: pgUUID(row.ID), name: row.Name, qty: qty}
		if contents := contentsOf(row.Data); len(contents) > 0 {
			if *lib == nil {
				l, err := s.itemLibraryFor(ctx, userID)
				if err != nil {
					return giftLine{}, "", err
				}
				*lib = l
			}
			line.stock = unpackedLines(*lib, contents, qty)
		}
		return line, "", nil
	case name != nil:
		written := strings.TrimSpace(*name)
		if written == "" || len([]rune(written)) > 80 {
			return giftLine{}, "an item name must be between 1 and 80 characters", nil
		}
		// Coin is the coin field's: a row named for the coin would be a
		// second till the shop never reads from.
		if strings.EqualFold(written, ladder.purseName()) {
			return giftLine{}, "give coin with the coin field, not as an item", nil
		}
		return giftLine{name: written, qty: qty}, "", nil
	default:
		return giftLine{}, "an item needs a library entry or a name", nil
	}
}

// fillPack puts goods and coin in one hero's pack — the one place that knows how
// (stacking, the purse made when there is none), whoever is giving. A non-empty
// message is a refusal to say; the caller rolls its transaction back.
func fillPack(ctx context.Context, qtx *db.Queries, hero uuid.UUID, stock []giftLine, coin int64, ladder Coinage) (string, error) {
	items, err := qtx.ListCharacterItems(ctx, hero)
	if err != nil {
		return "", err
	}
	if err := stockLines(ctx, qtx, hero, &items, stock); err != nil {
		return "", err
	}
	if coin <= 0 {
		return "", nil
	}
	if purse := pickPurse(items); purse != nil {
		locked, err := qtx.LockCharacterItem(ctx, purse.ID)
		if err != nil {
			return "", err
		}
		if int64(locked.Qty)+coin > purseCeiling {
			return "that would overfill a purse", nil
		}
		_, err = qtx.UpdateCharacterItem(ctx, db.UpdateCharacterItemParams{
			ID: locked.ID, Qty: locked.Qty + int32(coin),
			Equipped: locked.Equipped, Slot: locked.Slot, Attuned: locked.Attuned,
		})
		return "", err
	}
	_, err = qtx.AddCharacterItem(ctx, db.AddCharacterItemParams{
		CharacterID: hero, Name: ladder.purseName(), Qty: int32(coin), IsPurse: true,
	})
	return "", err
}

// joinGoods reads a list of things given — "a Torch, Rope and 50 gp".
func joinGoods(goods []string) string {
	switch len(goods) {
	case 0:
		return "something"
	case 1:
		return goods[0]
	default:
		return strings.Join(goods[:len(goods)-1], ", ") + " and " + goods[len(goods)-1]
	}
}

// stockLines puts lines in a hero's pack: each stacks onto a matching row when
// the result still fits (999 a row), and otherwise becomes a row of its own.
// `items` is the hero's pack as it stands and is kept current, so two lines
// for the same thing stack on each other. Shared by a gift and the shop.
func stockLines(ctx context.Context, qtx *db.Queries, hero uuid.UUID, items *[]db.ListCharacterItemsRow, lines []giftLine) error {
	for _, line := range lines {
		target := pickMergeTarget(*items, line.contentID, line.name, uuid.Nil)
		if target != nil && target.Qty+line.qty <= 999 {
			if _, err := qtx.UpdateCharacterItem(ctx, db.UpdateCharacterItemParams{
				ID: target.ID, Qty: target.Qty + line.qty,
				Equipped: target.Equipped, Slot: target.Slot, Attuned: target.Attuned,
			}); err != nil {
				return err
			}
			target.Qty += line.qty
			continue
		}
		created, err := qtx.AddCharacterItem(ctx, db.AddCharacterItemParams{
			CharacterID: hero, ContentID: line.contentID, Name: line.name, Qty: line.qty,
		})
		if err != nil {
			return err
		}
		*items = append(*items, db.ListCharacterItemsRow{
			ID: created.ID, CharacterID: created.CharacterID, ContentID: created.ContentID,
			Name: created.Name, Qty: created.Qty,
		})
	}
	return nil
}
