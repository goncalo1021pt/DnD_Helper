package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// ListMyCharacters returns the caller's heroes across all campaigns,
// including the unseated ones resting in My Heroes.
func (s *Server) ListMyCharacters(ctx context.Context, _ api.ListMyCharactersRequestObject) (api.ListMyCharactersResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListMyCharacters401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	me, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	rows, err := s.queries.ListCharactersByOwner(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.Character, 0, len(rows))
	for _, row := range rows {
		c := toAPICharacterWithClass(db.Character{
			ID: row.ID, CampaignID: row.CampaignID, OwnerUserID: row.OwnerUserID,
			Name: row.Name, Class: row.Class, Level: row.Level,
			HpCurrent: row.HpCurrent, HpMax: row.HpMax, CreatedAt: row.CreatedAt,
			Strength: row.Strength, Dexterity: row.Dexterity, Constitution: row.Constitution,
			Intelligence: row.Intelligence, Wisdom: row.Wisdom, Charisma: row.Charisma,
			Skills: row.Skills, ClassID: row.ClassID, SpeciesID: row.SpeciesID,
			BackgroundID: row.BackgroundID,
			SubclassID:   row.SubclassID,
			Feats:        row.Feats,
			SpellSlotsUsed: row.SpellSlotsUsed,
		}, me.Name, uid, row.ClassData)
		c.CampaignName = row.CampaignName
		out = append(out, c)
	}
	return api.ListMyCharacters200JSONResponse(out), nil
}

// CreateMyCharacter forges a hero in My Heroes, seated nowhere yet.
func (s *Server) CreateMyCharacter(ctx context.Context, request api.CreateMyCharacterRequestObject) (api.CreateMyCharacterResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.CreateMyCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	in, errMsg := validateCharacterInput(request.Body)
	if errMsg != "" {
		return api.CreateMyCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	character, err := s.queries.CreateAccountCharacter(ctx, db.CreateAccountCharacterParams{
		OwnerUserID: uid,
		Name:        in.name,
		Class:       in.class,
		Level:       in.level,
		HpCurrent:   in.hpCurrent,
		HpMax:       in.hpMax,
	})
	if err != nil {
		return nil, err
	}
	me, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.CreateMyCharacter201JSONResponse(toAPICharacter(character, me.Name, uid)), nil
}

// SeatCharacter moves a hero to a campaign table, or back to My Heroes.
// Owner only; seating requires the owner to be a member of that campaign.
func (s *Server) SeatCharacter(ctx context.Context, request api.SeatCharacterRequestObject) (api.SeatCharacterResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.SeatCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SeatCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if character.OwnerUserID != uid {
		return api.SeatCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}

	var target pgtype.UUID
	var campaignName *string
	if request.Body != nil && request.Body.CampaignId != nil {
		campaignID := uuid.UUID(*request.Body.CampaignId)
		campaign, err := s.queries.GetCampaign(ctx, campaignID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return api.SeatCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
			}
			return nil, err
		}
		if _, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: uid, CampaignID: campaignID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return api.SeatCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
			}
			return nil, err
		}
		// Strict seating: every rules reference must be legal in this world.
		refs, err := s.sheetContentIDs(ctx, character)
		if err != nil {
			return nil, err
		}
		blockers, err := s.codexBlockers(ctx, campaignID, refs)
		if err != nil {
			return nil, err
		}
		if len(blockers) > 0 {
			conflict := api.SeatConflict{Error: "the codex has not admitted this hero's lineage"}
			for _, b := range blockers {
				conflict.Missing = append(conflict.Missing, seatConflictItem(b))
			}
			return api.SeatCharacter409JSONResponse(conflict), nil
		}
		target = pgUUID(campaignID)
		campaignName = &campaign.Name
	}

	updated, err := s.queries.SeatCharacter(ctx, db.SeatCharacterParams{
		ID:         character.ID,
		CampaignID: target,
	})
	if err != nil {
		return nil, err
	}
	me, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := toAPICharacterWithClass(updated, me.Name, uid, s.classDataFor(ctx, updated))
	out.CampaignName = campaignName
	return api.SeatCharacter200JSONResponse(out), nil
}

// ListRules returns all content of one kind: the SRD seed plus this
// instance's homebrew. Any authenticated user may read the rules.
func (s *Server) ListRules(ctx context.Context, request api.ListRulesRequestObject) (api.ListRulesResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListRules401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.ListContentByKind(ctx, db.ListContentByKindParams{
		Kind:      db.ContentKind(string(request.Kind)),
		CreatedBy: pgUUID(uid),
	})
	if err != nil {
		return nil, err
	}
	out := make([]api.RulesContent, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAPIRulesContent(db.RulesContent{
			ID: row.ID, Kind: row.Kind, Source: row.Source,
			Name: row.Name, Summary: row.Summary, Data: row.Data,
			CreatedBy: row.CreatedBy,
		}, row.CreatorName, uid))
	}
	return api.ListRules200JSONResponse(out), nil
}
