package http

import (
	"context"
	"errors"
	"fmt"
	"strings"

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
			Xp:             row.Xp,
			PendingLevels:  row.PendingLevels,
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
	if target.Valid {
		s.logEvent(ctx, uuid.UUID(target.Bytes), uid, "hero_seated",
			fmt.Sprintf("%s takes a seat at the table", updated.Name))
	} else if prevCampaign, wasSeated := seatedCampaign(character); wasSeated {
		s.logEvent(ctx, prevCampaign, uid, "hero_unseated",
			fmt.Sprintf("%s leaves the table", updated.Name))
	}
	out := toAPICharacterWithClass(updated, me.Name, uid, s.classDataFor(ctx, updated))
	out.CampaignName = campaignName
	return api.SeatCharacter200JSONResponse(out), nil
}

// ListRules returns all content of one kind: the SRD seed plus this
// instance's homebrew. Any authenticated user may read the rules — except
// monsters, which belong to the Monster Den and stay behind the DM's screen.
// Players meet creatures through the Bestiary's measured reveal, not the raw
// library, so a non-DM sees an empty menagerie here.
func (s *Server) ListRules(ctx context.Context, request api.ListRulesRequestObject) (api.ListRulesResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListRules401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if request.Kind == api.Monster {
		isDM, err := s.isDMAnywhere(ctx, uid)
		if err != nil {
			return nil, err
		}
		if !isDM {
			return api.ListRules200JSONResponse([]api.RulesContent{}), nil
		}
	}
	rows, err := s.queries.ListContentByKind(ctx, db.ListContentByKindParams{
		Kind:      db.ContentKind(string(request.Kind)),
		CreatedBy: pgUUID(uid),
	})
	if err != nil {
		return nil, err
	}
	// Collapse identical official-book content that several users each
	// imported: the same (name, book) shows once, preferring the viewer's own
	// copy. Content with no book (hand-made homebrew, SRD) never collapses, so
	// genuinely distinct entries that happen to share a name are all kept.
	type bookKey struct{ name, book string }
	seen := make(map[bookKey]int, len(rows))
	out := make([]api.RulesContent, 0, len(rows))
	for _, row := range rows {
		item := toAPIRulesContent(db.RulesContent{
			ID: row.ID, Kind: row.Kind, Source: row.Source,
			Name: row.Name, Summary: row.Summary, Data: row.Data,
			CreatedBy: row.CreatedBy,
		}, row.CreatorName, uid)

		book, _ := item.Data["book"].(string)
		if strings.TrimSpace(book) == "" {
			out = append(out, item)
			continue
		}
		key := bookKey{name: strings.ToLower(row.Name), book: book}
		if idx, ok := seen[key]; ok {
			// A copy of this official entry is already shown; keep the
			// viewer's own over anyone else's.
			if item.Mine && !out[idx].Mine {
				out[idx] = item
			}
			continue
		}
		seen[key] = len(out)
		out = append(out, item)
	}
	return api.ListRules200JSONResponse(out), nil
}
