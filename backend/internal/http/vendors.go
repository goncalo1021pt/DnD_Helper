package http

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Shops, and who has been told about them (#102).

A vendor is prep, like an encounter: the DM stocks it at home and the party
meets it at the table. So it is filed under a place the same way an encounter
is, and the places tree does the rest — a smith in Phandalin turns up when the
party is in Phandalin.

Money moves (#174). A revealed, priced line has a Buy: the till reads the
price as whole gold (money.go), the coin leaves the hero's purse and the item
lands in their pack in one transaction, and the chronicle says so. Prices stay
free text — "a favor owed" is a legal thing for a trader to ask; it simply is
not something the till can charge.

The part worth reading is the redaction. A shop is revealed deliberately, one at
a time, and its shelves are revealed line by line — so a DM can show the party
the swords on the wall and keep what is under the counter. Like the encounter
tracker's player view, the filtering happens on the way out and never as a flag
the client is trusted to respect: a player is not sent a hidden shop with
`revealed: false`, they are not sent it at all.
*/

const maxVendorName = 80

// vendorForViewer shapes one shop for whoever is looking. For the DM that is
// everything; for a player it is the revealed lines and nothing else.
func vendorForViewer(v db.ListVendorsRow, stock []db.ListStockForCampaignRow, isDM bool, viewer uuid.UUID) api.Vendor {
	out := api.Vendor{
		Id:           v.ID,
		Name:         v.Name,
		Description:  v.Description,
		Revealed:     v.Revealed,
		LocationName: v.LocationName,
		IsDM:         isDM,
		Stock:        []api.VendorStock{},
	}
	if v.LocationID.Valid {
		id := uuid.UUID(v.LocationID.Bytes)
		out.LocationId = &id
	}
	for _, s := range stock {
		if s.VendorID != v.ID {
			continue
		}
		if !isDM && !s.Revealed {
			continue
		}
		out.Stock = append(out.Stock, stockForViewer(s, viewer))
	}
	return out
}

func stockForViewer(s db.ListStockForCampaignRow, viewer uuid.UUID) api.VendorStock {
	line := api.VendorStock{
		Id:       s.ID,
		Name:     s.Name,
		Price:    s.Price,
		Qty:      intPtr32(s.Qty),
		Revealed: s.Revealed,
	}
	if s.ContentID.Valid {
		id := uuid.UUID(s.ContentID.Bytes)
		line.ContentId = &id
		// The armory entry travels with the line so a player can read what they
		// are being offered rather than a name and a price.
		if s.Kind != nil {
			item := toAPIRulesContent(db.RulesContent{
				ID: id, Kind: *s.Kind, Name: s.Name, Data: s.Data,
			}, nil, viewer)
			if s.Source != nil {
				item.Source = api.RulesContentSource(*s.Source)
			}
			if s.Summary != nil {
				item.Summary = *s.Summary
			}
			line.Item = &item
		}
	}
	return line
}

// loadVendors assembles every shop in a campaign for one viewer.
func (s *Server) loadVendors(ctx context.Context, campaignID uuid.UUID, isDM bool, viewer uuid.UUID) ([]api.Vendor, error) {
	rows, err := s.queries.ListVendors(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	stock, err := s.queries.ListStockForCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out := make([]api.Vendor, 0, len(rows))
	for _, v := range rows {
		if !isDM && !v.Revealed {
			continue
		}
		out = append(out, vendorForViewer(v, stock, isDM, viewer))
	}
	return out, nil
}

// oneVendor re-reads a single shop after a DM's change, so every write answers
// with the same shape the list does.
func (s *Server) oneVendor(ctx context.Context, campaignID, vendorID, viewer uuid.UUID) (api.Vendor, error) {
	return s.oneVendorFor(ctx, campaignID, vendorID, true, viewer)
}

// oneVendorFor is oneVendor with the viewer's real role — a player's buy
// receipt must be built with it, or the receipt would carry hidden shelves.
func (s *Server) oneVendorFor(ctx context.Context, campaignID, vendorID uuid.UUID, isDM bool, viewer uuid.UUID) (api.Vendor, error) {
	all, err := s.loadVendors(ctx, campaignID, isDM, viewer)
	if err != nil {
		return api.Vendor{}, err
	}
	for _, v := range all {
		if v.Id == vendorID {
			return v, nil
		}
	}
	return api.Vendor{}, pgx.ErrNoRows
}

// requireVendorDM resolves a shop and enforces the DM role over its campaign.
func (s *Server) requireVendorDM(ctx context.Context, vendorID uuid.UUID) (db.Vendor, error) {
	v, err := s.queries.GetVendor(ctx, vendorID)
	if err != nil {
		return db.Vendor{}, err
	}
	if _, err := s.requireDM(ctx, v.CampaignID); err != nil {
		return v, err
	}
	return v, nil
}

func vendorName(raw string) (string, string) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", "a shop needs a name"
	}
	if len([]rune(name)) > maxVendorName {
		return "", "that name is too long for a shopfront"
	}
	return name, ""
}

// --- the shops --------------------------------------------------------------

func (s *Server) ListVendors(ctx context.Context, request api.ListVendorsRequestObject) (api.ListVendorsResponseObject, error) {
	m, err := s.requireMember(ctx, request.CampaignId)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListVendors401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListVendors403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	out, err := s.loadVendors(ctx, request.CampaignId, m.Role == db.MembershipRoleDm, m.UserID)
	if err != nil {
		return nil, err
	}
	return api.ListVendors200JSONResponse(out), nil
}

func (s *Server) CreateVendor(ctx context.Context, request api.CreateVendorRequestObject) (api.CreateVendorResponseObject, error) {
	m, err := s.requireDM(ctx, request.CampaignId)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateVendor401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateVendor403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.CreateVendor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a shop is required"}}, nil
	}
	name, msg := vendorName(request.Body.Name)
	if msg != "" {
		return api.CreateVendor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	locID, _, err := s.resolveCampaignLocation(ctx, request.CampaignId, request.Body.LocationId)
	if err != nil {
		return nil, err
	}
	if request.Body.LocationId != nil && !locID.Valid {
		return api.CreateVendor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownPlace}}, nil
	}
	desc := ""
	if request.Body.Description != nil {
		desc = strings.TrimSpace(*request.Body.Description)
	}
	v, err := s.queries.CreateVendor(ctx, db.CreateVendorParams{
		CampaignID: request.CampaignId, Name: name, Description: desc,
		LocationID: locID, CreatedBy: pgUUID(m.UserID),
	})
	if err != nil {
		return nil, err
	}
	out, err := s.oneVendor(ctx, request.CampaignId, v.ID, m.UserID)
	if err != nil {
		return nil, err
	}
	s.publish(request.CampaignId, live.TopicVendors)
	return api.CreateVendor201JSONResponse(out), nil
}

func (s *Server) UpdateVendor(ctx context.Context, request api.UpdateVendorRequestObject) (api.UpdateVendorResponseObject, error) {
	v, err := s.requireVendorDM(ctx, request.VendorId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateVendor404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateVendor401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateVendor403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateVendor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a shop is required"}}, nil
	}
	name, msg := vendorName(request.Body.Name)
	if msg != "" {
		return api.UpdateVendor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	// A PATCH that carries the whole filing, like FileEncounter: an absent
	// locationId cannot be told from a null one, and a DM revealing a shop
	// should not quietly unpin it from its street.
	locID := v.LocationID
	if request.Body.LocationId != nil {
		resolved, _, err := s.resolveCampaignLocation(ctx, v.CampaignID, request.Body.LocationId)
		if err != nil {
			return nil, err
		}
		if !resolved.Valid {
			return api.UpdateVendor400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownPlace}}, nil
		}
		locID = resolved
	}
	desc := v.Description
	if request.Body.Description != nil {
		desc = strings.TrimSpace(*request.Body.Description)
	}
	revealed := v.Revealed
	if request.Body.Revealed != nil {
		revealed = *request.Body.Revealed
	}
	if _, err := s.queries.UpdateVendor(ctx, db.UpdateVendorParams{
		ID: v.ID, Name: name, Description: desc, LocationID: locID, Revealed: revealed,
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneVendor(ctx, v.CampaignID, v.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(v.CampaignID, live.TopicVendors)
	return api.UpdateVendor200JSONResponse(out), nil
}

func (s *Server) DeleteVendor(ctx context.Context, request api.DeleteVendorRequestObject) (api.DeleteVendorResponseObject, error) {
	v, err := s.requireVendorDM(ctx, request.VendorId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteVendor404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteVendor401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteVendor403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteVendor(ctx, v.ID); err != nil {
		return nil, err
	}
	s.publish(v.CampaignID, live.TopicVendors)
	return api.DeleteVendor204Response{}, nil
}

// --- the shelves ------------------------------------------------------------

func (s *Server) AddStock(ctx context.Context, request api.AddStockRequestObject) (api.AddStockResponseObject, error) {
	v, err := s.requireVendorDM(ctx, request.VendorId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.AddStock404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		switch {
		case errors.Is(err, errNoAuth):
			return api.AddStock401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.AddStock403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	badRequest := func(msg string) (api.AddStockResponseObject, error) {
		return api.AddStock400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a line is required")
	}

	var contentID pgtype.UUID
	name := ""
	price := ""
	if request.Body.Name != nil {
		name = strings.TrimSpace(*request.Body.Name)
	}
	if request.Body.Price != nil {
		price = strings.TrimSpace(*request.Body.Price)
	}
	if request.Body.ContentId != nil {
		item, err := s.queries.GetContent(ctx, *request.Body.ContentId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return badRequest("that item is not in the armory")
			}
			return nil, err
		}
		contentID = pgUUID(item.ID)
		if name == "" {
			name = item.Name
		}
		// A shop marks up, but starting from the book price beats starting from
		// nothing — the DM types over it when this trader is a robber.
		if price == "" {
			var d struct {
				Cost string `json:"cost"`
			}
			_ = json.Unmarshal(item.Data, &d)
			price = d.Cost
		}
	}
	if name == "" {
		return badRequest("a line needs an item or a name")
	}
	if len([]rune(name)) > maxVendorName {
		return badRequest("that name is too long for a shelf")
	}

	if _, err := s.queries.AddStock(ctx, db.AddStockParams{
		VendorID: v.ID, ContentID: contentID, Name: name, Price: price, Qty: int32Ptr(request.Body.Qty),
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneVendor(ctx, v.CampaignID, v.ID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(v.CampaignID, live.TopicVendors)
	return api.AddStock201JSONResponse(out), nil
}

func (s *Server) UpdateStock(ctx context.Context, request api.UpdateStockRequestObject) (api.UpdateStockResponseObject, error) {
	row, err := s.queries.GetStock(ctx, request.StockId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateStock404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateStock401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateStock403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if request.Body == nil {
		return api.UpdateStock400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a change is required"}}, nil
	}
	price := row.Price
	if request.Body.Price != nil {
		price = strings.TrimSpace(*request.Body.Price)
	}
	qty := row.Qty
	if request.Body.Qty != nil {
		qty = int32Ptr(request.Body.Qty)
	}
	revealed := row.Revealed
	if request.Body.Revealed != nil {
		revealed = *request.Body.Revealed
	}
	if _, err := s.queries.UpdateStock(ctx, db.UpdateStockParams{
		ID: row.ID, Price: price, Qty: qty, Revealed: revealed,
	}); err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out, err := s.oneVendor(ctx, row.CampaignID, row.VendorID, uid)
	if err != nil {
		return nil, err
	}
	s.publish(row.CampaignID, live.TopicVendors)
	return api.UpdateStock200JSONResponse(out), nil
}

func (s *Server) DeleteStock(ctx context.Context, request api.DeleteStockRequestObject) (api.DeleteStockResponseObject, error) {
	row, err := s.queries.GetStock(ctx, request.StockId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteStock404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteStock401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteStock403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteStock(ctx, row.ID); err != nil {
		return nil, err
	}
	s.publish(row.CampaignID, live.TopicVendors)
	return api.DeleteStock204Response{}, nil
}

// --- the till (#174) --------------------------------------------------------

// pickPurse finds the hero's Gold Pieces: the first content-less row bearing
// exactly that name, which is the same rule the sheet reads it by
// (HeroSheetPage.tsx) — the two must agree or the Buy button and the till
// would argue about the same purse.
func pickPurse(items []db.ListCharacterItemsRow) *db.ListCharacterItemsRow {
	for i := range items {
		if !items[i].ContentID.Valid && items[i].Name == "Gold Pieces" {
			return &items[i]
		}
	}
	return nil
}

// pickMergeTarget finds the pack row a purchase stacks onto: same armory
// entry (or exact name, for written-in lines), not equipped, not attuned, not
// full, and never the purse itself — a shelf line literally named "Gold
// Pieces" must not merge into the coin that just paid for it.
func pickMergeTarget(items []db.ListCharacterItemsRow, contentID pgtype.UUID, name string, skipID uuid.UUID) *db.ListCharacterItemsRow {
	for i := range items {
		it := &items[i]
		if it.ID == skipID || it.Equipped || it.Attuned || it.Qty >= 999 {
			continue
		}
		if contentID.Valid {
			if it.ContentID.Valid && it.ContentID.Bytes == contentID.Bytes {
				return it
			}
			continue
		}
		if !it.ContentID.Valid && it.Name == name {
			return it
		}
	}
	return nil
}

// BuyStock: one of a line, bought by a seated hero. The coin and the goods
// move together or not at all.
func (s *Server) BuyStock(ctx context.Context, request api.BuyStockRequestObject) (api.BuyStockResponseObject, error) {
	row, err := s.queries.GetStock(ctx, request.StockId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.BuyStock404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	vendor, err := s.queries.GetVendor(ctx, row.VendorID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.BuyStock404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	member, err := s.requireMember(ctx, row.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.BuyStock401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.BuyStock403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	isDM := member.Role == db.MembershipRoleDm
	// A shelf a player was never shown cannot be bought from, even by guessing
	// its id — 404, not 403, or the redaction leaks by probe (like ClaimQuest).
	if !isDM && (!vendor.Revealed || !row.Revealed) {
		return api.BuyStock404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	badRequest := func(msg string) (api.BuyStockResponseObject, error) {
		return api.BuyStock400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a buyer is required")
	}
	ch, err := s.queries.GetCharacter(ctx, request.Body.CharacterId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.BuyStock404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if seatedAt, seated := seatedCampaign(ch); !seated || seatedAt != row.CampaignID {
		return badRequest("that hero is not seated at this table")
	}
	if ch.OwnerUserID != member.UserID && !isDM {
		return api.BuyStock403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	gp, ok := priceGP(row.Price)
	if !ok {
		return badRequest("this line has no price the till can take")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if _, err := qtx.SellStock(ctx, row.ID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.BuyStock409JSONResponse{Error: "sold out — the shelf emptied under your hand"}, nil
		}
		return nil, err
	}
	items, err := qtx.ListCharacterItems(ctx, ch.ID)
	if err != nil {
		return nil, err
	}
	purse := pickPurse(items)
	goldRemaining := 0
	if purse != nil {
		goldRemaining = int(purse.Qty)
	}
	if gp > 0 {
		if purse == nil {
			return badRequest("the purse is empty and the trader asks " + strconv.Itoa(gp) + " gp")
		}
		// Under lock: two purchases must not both spend the same coin.
		locked, err := qtx.LockCharacterItem(ctx, purse.ID)
		if err != nil {
			return nil, err
		}
		if int(locked.Qty) < gp {
			return badRequest("the purse holds " + strconv.Itoa(int(locked.Qty)) +
				" gp and the trader asks " + strconv.Itoa(gp) + " gp")
		}
		if int(locked.Qty) == gp {
			// The schema forbids a zero-quantity row; an emptied purse is gone.
			if err := qtx.DeleteCharacterItem(ctx, locked.ID); err != nil {
				return nil, err
			}
		} else if _, err := qtx.UpdateCharacterItem(ctx, db.UpdateCharacterItemParams{
			ID: locked.ID, Qty: locked.Qty - int32(gp),
			Equipped: locked.Equipped, Slot: locked.Slot, Attuned: locked.Attuned,
		}); err != nil {
			return nil, err
		}
		goldRemaining = int(locked.Qty) - gp
	}
	// No codex check, deliberately: the DM shelving this line IS the world
	// admitting the item (contrast AddInventoryItem, where the player brings
	// something in from outside).
	purseID := uuid.Nil
	if purse != nil {
		purseID = purse.ID
	}
	if target := pickMergeTarget(items, row.ContentID, row.Name, purseID); target != nil {
		if _, err := qtx.UpdateCharacterItem(ctx, db.UpdateCharacterItemParams{
			ID: target.ID, Qty: target.Qty + 1,
			Equipped: target.Equipped, Slot: target.Slot, Attuned: target.Attuned,
		}); err != nil {
			return nil, err
		}
	} else if _, err := qtx.AddCharacterItem(ctx, db.AddCharacterItemParams{
		CharacterID: ch.ID, ContentID: row.ContentID, Name: row.Name, Qty: 1,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// A bought shield mid-fight moves the number the DM rolls against.
	if err := s.syncCombatantAC(ctx, ch); err != nil {
		return nil, err
	}
	s.logEvent(ctx, row.CampaignID, member.UserID, "purchase",
		ch.Name+" buys "+row.Name+" from "+vendor.Name+" for "+strconv.Itoa(gp)+" gp")
	s.publish(row.CampaignID, live.TopicVendors)
	s.publish(row.CampaignID, live.TopicParty)

	out, err := s.oneVendorFor(ctx, row.CampaignID, row.VendorID, isDM, member.UserID)
	if err != nil {
		return nil, err
	}
	return api.BuyStock200JSONResponse(api.BuyReceipt{
		Vendor: out, PaidGp: gp, GoldRemaining: goldRemaining,
	}), nil
}

// The stock count crosses two type systems: the spec says integer (int) and
// Postgres says INT (int32), and both may be absent — "as many as you like".
func intPtr32(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

func int32Ptr(v *int) *int32 {
	if v == nil {
		return nil
	}
	n := int32(*v)
	return &n
}
