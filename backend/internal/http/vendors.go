package http

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Shops, and who has been told about them (#102).

A vendor is prep, like an encounter: the DM stocks it at home and the party
meets it at the table. So it is filed under a place the same way an encounter
is, and the places tree does the rest — a smith in Phandalin turns up when the
party is in Phandalin.

No money moves. Buying is a conversation at the table; this holds the list the
DM reads from.

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

// oneVendor re-reads a single shop after a change, so every write answers with
// the same shape the list does.
func (s *Server) oneVendor(ctx context.Context, campaignID, vendorID, viewer uuid.UUID) (api.Vendor, error) {
	all, err := s.loadVendors(ctx, campaignID, true, viewer)
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
	return api.DeleteStock204Response{}, nil
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
