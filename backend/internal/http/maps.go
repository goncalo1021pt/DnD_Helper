package http

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

// The Map: campaign atlases with pins. Images live in postgres (one backup
// carries the world); metadata and pins ride the generated API, while the
// image bytes stream through a hand-rolled route (ServeMapImage) so the
// spec stays JSON-only.

const maxMapImageBytes = 10 << 20 // 10 MB decoded

// mapRow is the shared shape of every no-image maps query row read THROUGH a
// campaign (#234): RealmID is the ground it hangs on, CampaignID the lens it
// was read through, and VisibleToParty that lens's own veil. Field order
// matches GetMapMetaForCampaignRow, so the struct conversion holds.
type mapRow struct {
	ID             uuid.UUID
	RealmID        uuid.UUID
	CampaignID     uuid.UUID
	ParentMapID    pgtype.UUID
	Name           string
	FogEnabled     bool
	Width          int32
	Height         int32
	CreatedAt      pgtype.Timestamptz
	LocationID     pgtype.UUID
	VisibleToParty bool
}

// listedMapRow narrows the atlas query's row to the shared shape. sqlc gives
// the joined query its own struct, so this is the one place the two are lined
// up rather than a conversion repeated at every call site.
func listedMapRow(r db.ListMapsByCampaignRow) mapRow {
	return mapRow{
		ID: r.ID, RealmID: r.RealmID, CampaignID: r.CampaignID, ParentMapID: r.ParentMapID,
		Name: r.Name, FogEnabled: r.FogEnabled, Width: r.Width,
		Height: r.Height, CreatedAt: r.CreatedAt, LocationID: r.LocationID,
		VisibleToParty: r.VisibleToParty,
	}
}

// toAPIMap renders one map. forDM is a parameter and never a default, the
// lesson the invite code taught (#207): every call site has to say who is
// reading, so a new one cannot leak the veil by forgetting. A player's copy
// carries nothing about who else may see it — and a map they may not see is
// absent from their payload entirely, so the flag would only ever say true.
func toAPIMap(m mapRow, forDM bool, overrides []api.VisibilityOverride) api.CampaignMap {
	out := api.CampaignMap{
		Id:         m.ID,
		CampaignId: m.CampaignID,
		RealmId:    m.RealmID,
		Name:       m.Name,
		FogEnabled: m.FogEnabled,
		Width:      int(m.Width),
		Height:     int(m.Height),
		CreatedAt:  m.CreatedAt.Time,
	}
	if m.LocationID.Valid {
		id := uuid.UUID(m.LocationID.Bytes)
		out.LocationId = &id
	}
	if m.ParentMapID.Valid {
		id := uuid.UUID(m.ParentMapID.Bytes)
		out.ParentMapId = &id
	}
	if forDM {
		visible := m.VisibleToParty
		out.VisibleToParty = &visible
		out.VisibilityOverrides = &overrides
	}
	return out
}

func toAPIPin(p db.MapPin) api.MapPin {
	out := api.MapPin{
		Id:        p.ID,
		MapId:     p.MapID,
		Label:     p.Label,
		Note:      p.Note,
		X:         float32(p.X),
		Y:         float32(p.Y),
		DmOnly:    p.DmOnly,
		Shape:     (*api.MapPinShape)(&p.Shape),
		CreatedAt: p.CreatedAt.Time,
	}
	if p.LinkMapID.Valid {
		id := uuid.UUID(p.LinkMapID.Bytes)
		out.LinkMapId = &id
	}
	return out
}

// decodeMapImage validates and measures an uploaded image: base64 → bytes,
// sniffed type must be JPEG or PNG, and the header must decode for w/h.
func decodeMapImage(b64 string) (data []byte, contentType string, w, h int, err error) {
	// Tolerate a data-URL prefix from a FileReader.
	if i := strings.IndexByte(b64, ','); i >= 0 && strings.HasPrefix(b64, "data:") {
		b64 = b64[i+1:]
	}
	data, err = base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, "", 0, 0, fmt.Errorf("image is not valid base64")
	}
	if len(data) == 0 {
		return nil, "", 0, 0, fmt.Errorf("image is empty")
	}
	if len(data) > maxMapImageBytes {
		return nil, "", 0, 0, fmt.Errorf("image is larger than 10 MB")
	}
	contentType = http.DetectContentType(data)
	if contentType != "image/jpeg" && contentType != "image/png" {
		return nil, "", 0, 0, fmt.Errorf("only JPEG and PNG maps are accepted")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, fmt.Errorf("the image would not decode")
	}
	return data, contentType, cfg.Width, cfg.Height, nil
}

// mapMeta reads a map THROUGH one campaign (#234): the row with that table's
// veil overlaid, or pgx.ErrNoRows — the caller's 404 branch — when the map is
// not on the campaign's realm, so a map you do not stand on cannot be told
// from one that never was.
func (s *Server) mapMeta(ctx context.Context, mapID, campaignID uuid.UUID) (db.GetMapMetaForCampaignRow, error) {
	return s.queries.GetMapMetaForCampaign(ctx, db.GetMapMetaForCampaignParams{MapID: mapID, CampaignID: campaignID})
}

// validateParentMap checks that a prospective parent exists, stands on the
// same realm, and doesn't create a cycle back to the child.
func (s *Server) validateParentMap(ctx context.Context, realmID, childID uuid.UUID, parent *uuid.UUID) error {
	if parent == nil {
		return nil
	}
	if *parent == childID {
		return fmt.Errorf("a map cannot be its own parent")
	}
	seen := 0
	cur := *parent
	for {
		p, err := s.queries.GetMapMeta(ctx, cur)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("parent map not found")
			}
			return err
		}
		if p.RealmID != realmID {
			return fmt.Errorf("parent map belongs to another realm")
		}
		if !p.ParentMapID.Valid {
			return nil
		}
		next := uuid.UUID(p.ParentMapID.Bytes)
		if next == childID {
			return fmt.Errorf("that would hang a map inside its own detail")
		}
		if seen++; seen > 20 {
			return nil
		}
		cur = next
	}
}

// ListMaps returns the campaign's atlas — metadata only, members.
func (s *Server) ListMaps(ctx context.Context, request api.ListMapsRequestObject) (api.ListMapsResponseObject, error) {
	m, err := s.requireMember(ctx, request.CampaignId)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListMaps401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListMaps403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	rows, err := s.queries.ListMapsByCampaign(ctx, request.CampaignId)
	if err != nil {
		return nil, err
	}
	isDM := m.Role == db.MembershipRoleDm
	viewer, err := s.mapViewerFor(ctx, request.CampaignId, m.UserID, isDM)
	if err != nil {
		return nil, err
	}
	out := make([]api.CampaignMap, 0, len(rows))
	for _, r := range rows {
		row := listedMapRow(r)
		// Absent, not flagged: a veiled map never reaches the shelf at all.
		if !viewer.mayRead(row) {
			continue
		}
		am := toAPIMap(row, isDM, viewer.veil.overridesFor(r.ID))
		am.LocationName = r.LocationName
		out = append(out, am)
	}
	return api.ListMaps200JSONResponse(out), nil
}

// CreateMap hangs a new map in the atlas (DM only).
func (s *Server) CreateMap(ctx context.Context, request api.CreateMapRequestObject) (api.CreateMapResponseObject, error) {
	if _, err := s.requireDM(ctx, request.CampaignId); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateMap401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateMap403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	name := strings.TrimSpace(request.Body.Name)
	if name == "" {
		return api.CreateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "the map needs a name"}}, nil
	}
	data, contentType, w, h, err := decodeMapImage(request.Body.ImageBase64)
	if err != nil {
		return api.CreateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: err.Error()}}, nil
	}
	// The ground this map is hung on: the campaign's realm (#234).
	campaign, err := s.queries.GetCampaign(ctx, request.CampaignId)
	if err != nil {
		return nil, err
	}
	if err := s.validateParentMap(ctx, campaign.RealmID, uuid.Nil, request.Body.ParentMapId); err != nil {
		return api.CreateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: err.Error()}}, nil
	}
	parent := pgtype.UUID{}
	if request.Body.ParentMapId != nil {
		parent = pgUUID(*request.Body.ParentMapId)
	}
	// The place this map depicts (#229) — optional, and it must be this
	// campaign's ground.
	locID, _, err := s.resolveCampaignLocation(ctx, request.CampaignId, request.Body.LocationId)
	if err != nil {
		return nil, err
	}
	if request.Body.LocationId != nil && !locID.Valid {
		return api.CreateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownPlace}}, nil
	}
	// A new map is the DM's until they hang it in the hall (#276) — a lair map
	// is uploaded before the session it is found in. The form may say otherwise
	// in the same breath, for the world map that is nobody's secret.
	visible := request.Body.VisibleToParty != nil && *request.Body.VisibleToParty
	row, err := s.queries.CreateMap(ctx, db.CreateMapParams{
		RealmID:     campaign.RealmID,
		ParentMapID: parent,
		LocationID:  locID,
		Name:        name,
		Image:       data,
		ContentType: contentType,
		Width:       int32(w),
		Height:      int32(h),
	})
	if err != nil {
		return nil, err
	}
	// The veil is the hanging table's own (#234): the ground row carries none.
	if err := s.queries.SetMapPartyVisibility(ctx, db.SetMapPartyVisibilityParams{
		MapID: row.ID, CampaignID: request.CampaignId, VisibleToParty: visible,
	}); err != nil {
		return nil, err
	}
	out := mapRow{
		ID: row.ID, RealmID: row.RealmID, CampaignID: request.CampaignId,
		ParentMapID: row.ParentMapID, Name: row.Name, FogEnabled: row.FogEnabled,
		Width: row.Width, Height: row.Height, CreatedAt: row.CreatedAt,
		LocationID: row.LocationID, VisibleToParty: visible,
	}
	// Hung on shared ground: every table on the realm hears of it (veiled).
	s.publishRealm(ctx, campaign.RealmID, live.TopicMap)
	return api.CreateMap201JSONResponse(toAPIMap(out, true, nil)), nil
}

// GetMap returns one map with its pins; players never receive DM-only pins.
func (s *Server) GetMap(ctx context.Context, request api.GetMapRequestObject) (api.GetMapResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetMap404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	m, err := s.requireMember(ctx, meta.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetMap401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetMap403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	isDM := m.Role == db.MembershipRoleDm
	// One viewer for this whole request: the map on the table, and every
	// marker leading off it (#276).
	viewer, err := s.mapViewerFor(ctx, meta.CampaignID, m.UserID, isDM)
	if err != nil {
		return nil, err
	}
	// A map you may not know exists must not be tellable from one that never
	// did: 404, never 403.
	if !viewer.mayRead(mapRow(meta)) {
		return api.GetMap404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	pins, err := s.queries.ListMapPins(ctx, request.MapId)
	if err != nil {
		return nil, err
	}

	// The caller's uncovered ground: everything for the DM, the union of
	// their pools for a player. Stays empty while the fog is off.
	revealed := []api.RevealCircle{}
	if meta.FogEnabled {
		if isDM {
			rows, err := s.queries.ListAllRevealCircles(ctx, db.ListAllRevealCirclesParams{MapID: request.MapId, CampaignID: meta.CampaignID})
			if err != nil {
				return nil, err
			}
			for _, c := range rows {
				revealed = append(revealed, api.RevealCircle{X: float32(c.X), Y: float32(c.Y), R: float32(c.R)})
			}
		} else {
			circles, err := s.playerRevealCircles(ctx, request.MapId, meta.CampaignID, m.UserID)
			if err != nil {
				return nil, err
			}
			for _, c := range circles {
				revealed = append(revealed, api.RevealCircle{X: float32(c.X), Y: float32(c.Y), R: float32(c.R)})
			}
		}
	}

	// Under fog, a player only receives pins standing on revealed ground —
	// a hidden village must not leak through its marker.
	aspect := float64(meta.Height) / float64(meta.Width)
	inRevealed := func(p db.MapPin) bool {
		for _, c := range revealed {
			dx := p.X - float64(c.X)
			dy := (p.Y - float64(c.Y)) * aspect
			r := float64(c.R)
			if dx*dx+dy*dy <= r*r {
				return true
			}
		}
		return false
	}

	// A region marker leading into a map this viewer may not know exists is
	// that map's name in their hand (#276), so it goes with it. Resolved once
	// per map rather than once per pin: several pins may lead to the same one.
	leadsSomewhereVeiled := func(db.MapPin) bool { return false }
	if !isDM {
		seen := map[uuid.UUID]bool{}
		leadsSomewhereVeiled = func(p db.MapPin) bool {
			if !p.LinkMapID.Valid {
				return false
			}
			id := uuid.UUID(p.LinkMapID.Bytes)
			if known, ok := seen[id]; ok {
				return known
			}
			// A map that has since been struck reads as veiled: a marker
			// leading nowhere is not worth handing over either.
			linked, lerr := s.mapMeta(ctx, id, meta.CampaignID)
			veiled := lerr != nil || !viewer.mayRead(mapRow(linked))
			seen[id] = veiled
			return veiled
		}
	}

	outPins := make([]api.MapPin, 0, len(pins))
	for _, p := range pins {
		if !isDM {
			if p.DmOnly {
				continue
			}
			if meta.FogEnabled && !inRevealed(p) {
				continue
			}
			if leadsSomewhereVeiled(p) {
				continue
			}
		}
		outPins = append(outPins, toAPIPin(p))
	}
	// Roads and regions ride the same veil the pins do (#262): absent when
	// DM-only, and a line clipped to the stretches this viewer has uncovered.
	shapes, err := s.shapesFor(ctx, request.MapId, isDM, aspect, revealed, meta.FogEnabled)
	if err != nil {
		return nil, err
	}
	return api.GetMap200JSONResponse(api.MapDetail{
		Map:      toAPIMap(mapRow(meta), isDM, viewer.veil.overridesFor(meta.ID)),
		Pins:     outPins,
		Shapes:   shapes,
		Revealed: revealed,
	}), nil
}

// UpdateMap renames a map or re-hangs it under a parent (DM only).
func (s *Server) UpdateMap(ctx context.Context, request api.UpdateMapRequestObject) (api.UpdateMapResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateMap404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateMap401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateMap403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	name := strings.TrimSpace(request.Body.Name)
	if name == "" {
		return api.UpdateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "the map needs a name"}}, nil
	}
	if err := s.validateParentMap(ctx, meta.RealmID, request.MapId, request.Body.ParentMapId); err != nil {
		return api.UpdateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: err.Error()}}, nil
	}
	parent := pgtype.UUID{}
	if request.Body.ParentMapId != nil {
		parent = pgUUID(*request.Body.ParentMapId)
	}
	fog := meta.FogEnabled
	if request.Body.FogEnabled != nil {
		fog = *request.Body.FogEnabled
	}
	// The place: absent means unchanged (a rename must not quietly unfile a
	// map — the shops' lesson), and the nil UUID unfiles deliberately, the
	// way the folk detach a sheet (#229).
	locID := meta.LocationID
	if request.Body.LocationId != nil {
		if *request.Body.LocationId == uuid.Nil {
			locID = pgtype.UUID{}
		} else {
			resolved, _, err := s.resolveCampaignLocation(ctx, meta.CampaignID, request.Body.LocationId)
			if err != nil {
				return nil, err
			}
			if !resolved.Valid {
				return api.UpdateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errUnknownPlace}}, nil
			}
			locID = resolved
		}
	}
	row, err := s.queries.UpdateMapMeta(ctx, db.UpdateMapMetaParams{
		ID:          request.MapId,
		Name:        name,
		ParentMapID: parent,
		FogEnabled:  fog,
		LocationID:  locID,
	})
	if err != nil {
		return nil, err
	}
	// Only the DM reaches this handler, and the veil is not theirs to change
	// here — /maps/{id}/visibility is the one door onto it — so the lens's
	// flag is carried over unchanged (#234).
	mv, err := s.loadMapVeil(ctx, meta.CampaignID)
	if err != nil {
		return nil, err
	}
	out := mapRow{
		ID: row.ID, RealmID: row.RealmID, CampaignID: meta.CampaignID,
		ParentMapID: row.ParentMapID, Name: row.Name, FogEnabled: row.FogEnabled,
		Width: row.Width, Height: row.Height, CreatedAt: row.CreatedAt,
		LocationID: row.LocationID, VisibleToParty: meta.VisibleToParty,
	}
	// A rename or a re-hang is shared ground: every table on the realm hears.
	s.publishRealm(ctx, meta.RealmID, live.TopicMap)
	return api.UpdateMap200JSONResponse(toAPIMap(out, true, mv.overridesFor(row.ID))), nil
}

// DeleteMap strikes a map and, by cascade, its pins (DM only).
func (s *Server) DeleteMap(ctx context.Context, request api.DeleteMapRequestObject) (api.DeleteMapResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteMap404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteMap401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteMap403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteMap(ctx, request.MapId); err != nil {
		return nil, err
	}
	s.publishRealm(ctx, meta.RealmID, live.TopicMap)
	return api.DeleteMap204Response{}, nil
}

// pinShapes are the markers a pin may wear (#262). "pin" is the teardrop every
// pin was before shapes existed, so an absent value means it.
var pinShapes = map[string]bool{
	"pin": true, "circle": true, "square": true, "diamond": true,
	"triangle": true, "star": true, "cross": true, "skull": true,
}

// mustPinShape is pinShapeOf's value alone, for call sites that have already
// had the input validated.
func mustPinShape(v *api.MapPinInputShape) string {
	s, _ := pinShapeOf(v)
	return s
}

func pinShapeOf(v *api.MapPinInputShape) (string, bool) {
	if v == nil || string(*v) == "" {
		return "pin", true
	}
	s := string(*v)
	return s, pinShapes[s]
}

// validatePinInput normalizes and checks a pin body against its map.
func (s *Server) validatePinInput(ctx context.Context, realmID uuid.UUID, body *api.MapPinInput) (label, note string, link pgtype.UUID, errMsg string, err error) {
	label = strings.TrimSpace(body.Label)
	if label == "" {
		return "", "", pgtype.UUID{}, "the pin needs a label", nil
	}
	if body.X < 0 || body.X > 1 || body.Y < 0 || body.Y > 1 {
		return "", "", pgtype.UUID{}, "pin coordinates are fractions of the map, 0 to 1", nil
	}
	if body.Note != nil {
		note = strings.TrimSpace(*body.Note)
	}
	if _, ok := pinShapeOf(body.Shape); !ok {
		return "", "", pgtype.UUID{}, "that is not a marker this map knows", nil
	}
	if body.LinkMapId != nil {
		target, err := s.queries.GetMapMeta(ctx, *body.LinkMapId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", "", pgtype.UUID{}, "linked map not found", nil
			}
			return "", "", pgtype.UUID{}, "", err
		}
		if target.RealmID != realmID {
			return "", "", pgtype.UUID{}, "linked map belongs to another realm", nil
		}
		link = pgUUID(*body.LinkMapId)
	}
	return label, note, link, "", nil
}

// CreateMapPin drops a pin on a map (DM only).
func (s *Server) CreateMapPin(ctx context.Context, request api.CreateMapPinRequestObject) (api.CreateMapPinResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId, uuid.UUID(request.Params.CampaignId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.CreateMapPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, meta.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateMapPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateMapPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	label, note, link, errMsg, err := s.validatePinInput(ctx, meta.RealmID, request.Body)
	if err != nil {
		return nil, err
	}
	if errMsg != "" {
		return api.CreateMapPin400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	pin, err := s.queries.CreateMapPin(ctx, db.CreateMapPinParams{
		MapID:     request.MapId,
		Label:     label,
		Note:      note,
		X:         float64(request.Body.X),
		Y:         float64(request.Body.Y),
		DmOnly:    request.Body.DmOnly != nil && *request.Body.DmOnly,
		LinkMapID: link,
		Shape:     mustPinShape(request.Body.Shape),
	})
	if err != nil {
		return nil, err
	}
	s.publishRealm(ctx, meta.RealmID, live.TopicMap)
	return api.CreateMapPin201JSONResponse(toAPIPin(pin)), nil
}

// UpdateMapPin moves or rewords a pin (DM only).
func (s *Server) UpdateMapPin(ctx context.Context, request api.UpdateMapPinRequestObject) (api.UpdateMapPinResponseObject, error) {
	// The lens first, then the pin through it (#234): a pin whose map is not
	// on this campaign's realm is no row, and answers 404.
	lensID := uuid.UUID(request.Params.CampaignId)
	if _, err := s.requireDM(ctx, lensID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateMapPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateMapPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	row, err := s.queries.GetMapPin(ctx, db.GetMapPinParams{PinID: request.PinId, CampaignID: lensID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateMapPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	label, note, link, errMsg, err := s.validatePinInput(ctx, row.RealmID, request.Body)
	if err != nil {
		return nil, err
	}
	if errMsg != "" {
		return api.UpdateMapPin400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	pin, err := s.queries.UpdateMapPin(ctx, db.UpdateMapPinParams{
		ID:        request.PinId,
		Label:     label,
		Note:      note,
		X:         float64(request.Body.X),
		Y:         float64(request.Body.Y),
		DmOnly:    request.Body.DmOnly != nil && *request.Body.DmOnly,
		LinkMapID: link,
		Shape:     mustPinShape(request.Body.Shape),
	})
	if err != nil {
		return nil, err
	}
	s.publishRealm(ctx, row.RealmID, live.TopicMap)
	return api.UpdateMapPin200JSONResponse(toAPIPin(pin)), nil
}

// DeleteMapPin pulls a pin off the map (DM only).
func (s *Server) DeleteMapPin(ctx context.Context, request api.DeleteMapPinRequestObject) (api.DeleteMapPinResponseObject, error) {
	lensID := uuid.UUID(request.Params.CampaignId)
	if _, err := s.requireDM(ctx, lensID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteMapPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteMapPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	row, err := s.queries.GetMapPin(ctx, db.GetMapPinParams{PinID: request.PinId, CampaignID: lensID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteMapPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteMapPin(ctx, request.PinId); err != nil {
		return nil, err
	}
	s.publishRealm(ctx, row.RealmID, live.TopicMap)
	return api.DeleteMapPin204Response{}, nil
}

// ServeMapImage streams a map's image bytes. Lives outside the OpenAPI spec
// (like the auth routes) so the contract stays JSON; same session middleware,
// same membership gate as GetMap. A fogged player never receives the hidden
// pixels: the image is composited server-side with everything outside their
// revealed circles blacked out, then cached per reveal fingerprint. The DM
// gets the full image. ETag/If-None-Match keep pan/zoom revisits cheap; the
// role and reveal state ride the ETag so a browser cache can't cross roles,
// and Cache-Control: no-cache forces revalidation on every load.
func (s *Server) ServeMapImage(w http.ResponseWriter, r *http.Request) {
	mapID, err := uuid.Parse(chi.URLParam(r, "mapID"))
	if err != nil {
		http.Error(w, "bad map id", http.StatusBadRequest)
		return
	}
	if _, ok := auth.UserID(r.Context()); !ok {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	// The lens (#234), taken the way the JSON map takes it — the picture and
	// the payload must agree about whose fog is on the glass.
	lensID, err := uuid.Parse(r.URL.Query().Get("campaignId"))
	if err != nil {
		http.Error(w, "campaignId is required", http.StatusBadRequest)
		return
	}
	meta, err := s.mapMeta(r.Context(), mapID, lensID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	m, err := s.requireMember(r.Context(), meta.CampaignID)
	if err != nil {
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	isDM := m.Role == db.MembershipRoleDm

	// The same gate the JSON map goes through (#276), and the same answer —
	// 404, not 403 — so the picture and the payload can never disagree about
	// whether a map exists.
	viewer, err := s.mapViewerFor(r.Context(), meta.CampaignID, m.UserID, isDM)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if !viewer.mayRead(mapRow(meta)) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Fogged path: a player on a fog-enabled map only sees revealed ground.
	if meta.FogEnabled && !isDM {
		circles, err := s.playerRevealCircles(r.Context(), mapID, meta.CampaignID, m.UserID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		version := fogVersion(circles)
		etag := fmt.Sprintf(`"fog-%s-%s"`, meta.ID, version)
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		entry, ok := s.fogCache.get(mapID, version)
		if !ok {
			img, err := s.queries.GetMapImage(r.Context(), mapID)
			if err != nil {
				http.Error(w, "server error", http.StatusInternalServerError)
				return
			}
			body, err := renderFoggedImage(img.Image, img.ContentType, circles)
			if err != nil {
				http.Error(w, "server error", http.StatusInternalServerError)
				return
			}
			entry = fogCacheEntry{version: version, body: body, contentType: img.ContentType}
			s.fogCache.put(mapID, entry)
		}
		w.Header().Set("Content-Type", entry.contentType)
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "private, no-cache")
		_, _ = w.Write(entry.body)
		return
	}

	// Full path: the DM, or any member when fog is off.
	etag := fmt.Sprintf(`"full-%s-%d"`, meta.ID, meta.CreatedAt.Time.Unix())
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	img, err := s.queries.GetMapImage(r.Context(), mapID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", img.ContentType)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	_, _ = w.Write(img.Image)
}
