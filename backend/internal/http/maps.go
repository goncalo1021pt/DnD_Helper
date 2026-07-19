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
)

// The Map: campaign atlases with pins. Images live in postgres (one backup
// carries the world); metadata and pins ride the generated API, while the
// image bytes stream through a hand-rolled route (ServeMapImage) so the
// spec stays JSON-only.

const maxMapImageBytes = 10 << 20 // 10 MB decoded

// mapRow is the shared shape of every no-image maps query row.
type mapRow struct {
	ID          uuid.UUID
	CampaignID  uuid.UUID
	ParentMapID pgtype.UUID
	Name        string
	Width       int32
	Height      int32
	CreatedAt   pgtype.Timestamptz
}

func toAPIMap(m mapRow) api.CampaignMap {
	out := api.CampaignMap{
		Id:         m.ID,
		CampaignId: m.CampaignID,
		Name:       m.Name,
		Width:      int(m.Width),
		Height:     int(m.Height),
		CreatedAt:  m.CreatedAt.Time,
	}
	if m.ParentMapID.Valid {
		id := uuid.UUID(m.ParentMapID.Bytes)
		out.ParentMapId = &id
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

// mapCampaign resolves a map to its campaign, translating missing maps to
// pgx.ErrNoRows for the caller's 404 branch.
func (s *Server) mapMeta(ctx context.Context, mapID uuid.UUID) (db.GetMapMetaRow, error) {
	return s.queries.GetMapMeta(ctx, mapID)
}

// validateParentMap checks that a prospective parent exists, shares the
// campaign, and doesn't create a cycle back to the child.
func (s *Server) validateParentMap(ctx context.Context, campaignID, childID uuid.UUID, parent *uuid.UUID) error {
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
		if p.CampaignID != campaignID {
			return fmt.Errorf("parent map belongs to another campaign")
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
	if _, err := s.requireMember(ctx, request.CampaignId); err != nil {
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
	out := make([]api.CampaignMap, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPIMap(mapRow(r)))
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
	if err := s.validateParentMap(ctx, request.CampaignId, uuid.Nil, request.Body.ParentMapId); err != nil {
		return api.CreateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: err.Error()}}, nil
	}
	parent := pgtype.UUID{}
	if request.Body.ParentMapId != nil {
		parent = pgUUID(*request.Body.ParentMapId)
	}
	row, err := s.queries.CreateMap(ctx, db.CreateMapParams{
		CampaignID:  request.CampaignId,
		ParentMapID: parent,
		Name:        name,
		Image:       data,
		ContentType: contentType,
		Width:       int32(w),
		Height:      int32(h),
	})
	if err != nil {
		return nil, err
	}
	return api.CreateMap201JSONResponse(toAPIMap(mapRow(row))), nil
}

// GetMap returns one map with its pins; players never receive DM-only pins.
func (s *Server) GetMap(ctx context.Context, request api.GetMapRequestObject) (api.GetMapResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
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
	pins, err := s.queries.ListMapPins(ctx, request.MapId)
	if err != nil {
		return nil, err
	}
	isDM := m.Role == db.MembershipRoleDm
	outPins := make([]api.MapPin, 0, len(pins))
	for _, p := range pins {
		if p.DmOnly && !isDM {
			continue
		}
		outPins = append(outPins, toAPIPin(p))
	}
	return api.GetMap200JSONResponse(api.MapDetail{Map: toAPIMap(mapRow(meta)), Pins: outPins}), nil
}

// UpdateMap renames a map or re-hangs it under a parent (DM only).
func (s *Server) UpdateMap(ctx context.Context, request api.UpdateMapRequestObject) (api.UpdateMapResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
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
	if err := s.validateParentMap(ctx, meta.CampaignID, request.MapId, request.Body.ParentMapId); err != nil {
		return api.UpdateMap400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: err.Error()}}, nil
	}
	parent := pgtype.UUID{}
	if request.Body.ParentMapId != nil {
		parent = pgUUID(*request.Body.ParentMapId)
	}
	row, err := s.queries.UpdateMapMeta(ctx, db.UpdateMapMetaParams{
		ID:          request.MapId,
		Name:        name,
		ParentMapID: parent,
	})
	if err != nil {
		return nil, err
	}
	return api.UpdateMap200JSONResponse(toAPIMap(mapRow(row))), nil
}

// DeleteMap strikes a map and, by cascade, its pins (DM only).
func (s *Server) DeleteMap(ctx context.Context, request api.DeleteMapRequestObject) (api.DeleteMapResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
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
	return api.DeleteMap204Response{}, nil
}

// validatePinInput normalizes and checks a pin body against its map.
func (s *Server) validatePinInput(ctx context.Context, campaignID uuid.UUID, body *api.MapPinInput) (label, note string, link pgtype.UUID, errMsg string, err error) {
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
	if body.LinkMapId != nil {
		target, err := s.queries.GetMapMeta(ctx, *body.LinkMapId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", "", pgtype.UUID{}, "linked map not found", nil
			}
			return "", "", pgtype.UUID{}, "", err
		}
		if target.CampaignID != campaignID {
			return "", "", pgtype.UUID{}, "linked map belongs to another campaign", nil
		}
		link = pgUUID(*body.LinkMapId)
	}
	return label, note, link, "", nil
}

// CreateMapPin drops a pin on a map (DM only).
func (s *Server) CreateMapPin(ctx context.Context, request api.CreateMapPinRequestObject) (api.CreateMapPinResponseObject, error) {
	meta, err := s.mapMeta(ctx, request.MapId)
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
	label, note, link, errMsg, err := s.validatePinInput(ctx, meta.CampaignID, request.Body)
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
	})
	if err != nil {
		return nil, err
	}
	return api.CreateMapPin201JSONResponse(toAPIPin(pin)), nil
}

// UpdateMapPin moves or rewords a pin (DM only).
func (s *Server) UpdateMapPin(ctx context.Context, request api.UpdateMapPinRequestObject) (api.UpdateMapPinResponseObject, error) {
	row, err := s.queries.GetMapPin(ctx, request.PinId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateMapPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateMapPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateMapPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	label, note, link, errMsg, err := s.validatePinInput(ctx, row.CampaignID, request.Body)
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
	})
	if err != nil {
		return nil, err
	}
	return api.UpdateMapPin200JSONResponse(toAPIPin(pin)), nil
}

// DeleteMapPin pulls a pin off the map (DM only).
func (s *Server) DeleteMapPin(ctx context.Context, request api.DeleteMapPinRequestObject) (api.DeleteMapPinResponseObject, error) {
	row, err := s.queries.GetMapPin(ctx, request.PinId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteMapPin404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, row.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteMapPin401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteMapPin403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return nil, err
	}
	if _, err := s.queries.DeleteMapPin(ctx, request.PinId); err != nil {
		return nil, err
	}
	return api.DeleteMapPin204Response{}, nil
}

// ServeMapImage streams a map's image bytes. Lives outside the OpenAPI spec
// (like the auth routes) so the contract stays JSON; same session middleware,
// same membership gate as GetMap. Sends a strong ETag and honors
// If-None-Match so pan/zoom revisits are free.
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
	meta, err := s.mapMeta(r.Context(), mapID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if _, err := s.requireMember(r.Context(), meta.CampaignID); err != nil {
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	etag := fmt.Sprintf(`"%s-%d"`, meta.ID, meta.CreatedAt.Time.Unix())
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
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = w.Write(img.Image)
}
