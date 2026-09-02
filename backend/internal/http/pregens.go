package http

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Pre-made heroes, offered and claimed (#180).

A DM running a one-shot often has characters ready before the players arrive.
A pregen is just one of the DM's own heroes, seated at the campaign and flagged
with the author who offered it. It waits in a pool the whole table can see; a
member *claims* it and it becomes theirs — no copy, no new sheet, a plain
change of owner, because it was already seated at the right table.

Two facts carry the whole feature and neither is a new veil or a new gate:

  - `pregen_by` set AND owner == author  → *available* (in the pool, held by
    the DM). The roster hides these — they are not the party yet.
  - `pregen_by` set AND owner != author  → *claimed* (played by a member).
    A normal seated hero that also remembers where it came from, so it can be
    released back to the pool.

Claiming does not knock at the seating door: the DM curated these, so the codex
and the approval gate the seat flow enforces are already the DM's answer. What
still applies is the seats-per-player cap — a claimed pregen is a seat held.
*/

// pregenCampaign returns the campaign a character is offered at and whether it
// is a pregen there at all (flagged and seated).
func pregenCampaign(c db.Character) (uuid.UUID, bool) {
	campaignID, seated := seatedCampaign(c)
	return campaignID, seated && c.PregenBy.Valid
}

// pregenAuthor is the user who offered a pregen; only meaningful when PregenBy
// is valid, which every caller checks first.
func pregenAuthor(c db.Character) uuid.UUID { return uuid.UUID(c.PregenBy.Bytes) }

// ListPregens returns the pool of unclaimed pre-made heroes at a table.
func (s *Server) ListPregens(ctx context.Context, request api.ListPregensRequestObject) (api.ListPregensResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListPregens401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListPregens403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	rows, err := s.queries.ListPregens(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	// Pregens are seated here, so their classes ride in the campaign's one
	// class read (#190) exactly as the roster's heroes do.
	classRows, err := s.queries.ListCharacterClassesForCampaign(ctx, pgUUID(campaignID))
	if err != nil {
		return nil, err
	}
	classesOf := byCharacter(classesFromCampaign(classRows))

	out := make([]api.Character, 0, len(rows))
	for _, row := range rows {
		character := toAPICharacterWithClass(db.Character{
			ID: row.ID, CampaignID: row.CampaignID, OwnerUserID: row.OwnerUserID,
			Name: row.Name, Class: row.Class, Level: row.Level,
			HpCurrent: row.HpCurrent, HpMax: row.HpMax, CreatedAt: row.CreatedAt,
			Strength: row.Strength, Dexterity: row.Dexterity, Constitution: row.Constitution,
			Intelligence: row.Intelligence, Wisdom: row.Wisdom, Charisma: row.Charisma,
			Skills: row.Skills, ClassID: row.ClassID, SpeciesID: row.SpeciesID,
			BackgroundID:   row.BackgroundID,
			SubclassID:     row.SubclassID,
			Feats:          row.Feats,
			SpeciesChoices: row.SpeciesChoices,
			SpellSlotsUsed: row.SpellSlotsUsed,
			HitDiceSpent:   row.HitDiceSpent,
			PoolsUsed:      row.PoolsUsed,
			Xp:             row.Xp,
			PendingLevels:  row.PendingLevels,
			TableBorn:      row.TableBorn,
			Kind:           row.Kind,
			PartyID:        row.PartyID,
			PregenBy:       row.PregenBy,
		}, row.OwnerName, member.UserID, row.ClassData, classesOf[row.ID])
		character.PartyName = row.PartyName
		out = append(out, character)
	}
	return api.ListPregens200JSONResponse(out), nil
}

// OfferPregen seats one of the DM's own unseated heroes into a campaign's pool.
func (s *Server) OfferPregen(ctx context.Context, request api.OfferPregenRequestObject) (api.OfferPregenResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.OfferPregen401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.OfferPregen403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.OfferPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "a hero to offer is required",
		}}, nil
	}

	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.Body.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.OfferPregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	// A pregen is the DM's own hero to hand out. Someone else's is a 404 rather
	// than a 403: a DM has no business learning which heroes exist on other
	// people's shelves by probing this door.
	if character.OwnerUserID != member.UserID {
		return api.OfferPregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if character.Kind == db.CharacterKindNpc {
		return api.OfferPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "this sheet belongs to one of the Folk, not the pregen pool",
		}}, nil
	}
	if character.TableBorn {
		return api.OfferPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "a hero born of a table cannot be offered as a pregen",
		}}, nil
	}
	if character.PregenBy.Valid {
		return api.OfferPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "this hero is already set out as a pregen",
		}}, nil
	}
	if _, seated := seatedCampaign(character); seated {
		return api.OfferPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "this hero is seated at a table — unseat them before offering them as a pregen",
		}}, nil
	}

	updated, err := s.queries.OfferPregen(ctx, db.OfferPregenParams{
		ID: character.ID, CampaignID: pgUUID(campaignID), PregenBy: pgUUID(member.UserID),
	})
	if err != nil {
		return nil, err
	}
	ownerName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, member.UserID, "pregen_offered",
		fmt.Sprintf("%s is set out as a pre-made hero to claim", updated.Name))
	s.publish(campaignID, live.TopicParty)
	out := toAPICharacterWithClass(updated, ownerName, member.UserID, s.classDataFor(ctx, updated), s.classesFor(ctx, updated))
	return api.OfferPregen201JSONResponse(out), nil
}

// WithdrawPregen pulls an unclaimed pregen back to the DM's My Heroes shelf.
func (s *Server) WithdrawPregen(ctx context.Context, request api.WithdrawPregenRequestObject) (api.WithdrawPregenResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireDM(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.WithdrawPregen401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.WithdrawPregen403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.WithdrawPregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	cid, isPregen := pregenCampaign(character)
	if !isPregen || cid != campaignID {
		return api.WithdrawPregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	// A claimed pregen belongs to its player now; the DM benches it through the
	// roster like any seated hero, not by yanking it out of a pool it has left.
	if character.OwnerUserID != pregenAuthor(character) {
		return api.WithdrawPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "this pregen has been claimed — it belongs to its player now",
		}}, nil
	}

	if _, err := s.queries.WithdrawPregen(ctx, character.ID); err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, member.UserID, "pregen_withdrawn",
		fmt.Sprintf("%s is taken back off the pregen pool", character.Name))
	s.publish(campaignID, live.TopicParty)
	return api.WithdrawPregen204Response{}, nil
}

// ClaimPregen hands an available pregen to the member claiming it.
func (s *Server) ClaimPregen(ctx context.Context, request api.ClaimPregenRequestObject) (api.ClaimPregenResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ClaimPregen401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClaimPregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	campaignID, isPregen := pregenCampaign(character)
	// Available means still held by its author. A claimed one, or a hero that
	// is no pregen at all, is simply not here to take — one 404 for both, so a
	// probe cannot tell "already taken" from "never offered".
	if !isPregen || character.OwnerUserID != pregenAuthor(character) {
		return api.ClaimPregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	// Only a member of the pregen's own table may take it.
	membership, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: uid, CampaignID: campaignID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ClaimPregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	_ = membership
	// The author (the DM who set it out) already owns it — there is nothing to
	// claim, only to withdraw.
	if uid == pregenAuthor(character) {
		return api.ClaimPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "you offered this hero — withdraw it rather than claiming it",
		}}, nil
	}
	// A claimed pregen is a seat held, so the table's seats-per-player cap
	// applies exactly as it does at the seating door (#171).
	campaign, err := s.queries.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	seated, err := s.queries.CountSeatedByOwner(ctx, db.CountSeatedByOwnerParams{
		OwnerUserID: uid, CampaignID: pgUUID(campaignID), ID: character.ID,
	})
	if err != nil {
		return nil, err
	}
	if seated >= int64(campaign.MaxSeatedPerPlayer) {
		return api.ClaimPregen400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: seatCapMessage(campaign.MaxSeatedPerPlayer),
		}}, nil
	}

	updated, err := s.queries.ClaimPregen(ctx, db.ClaimPregenParams{ID: character.ID, OwnerUserID: uid})
	if err != nil {
		return nil, err
	}
	claimerName, err := s.ownerName(ctx, uid)
	if err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, uid, "pregen_claimed",
		fmt.Sprintf("%s is taken up by %s", updated.Name, claimerName))
	s.publish(campaignID, live.TopicParty)
	out := toAPICharacterWithClass(updated, claimerName, uid, s.classDataFor(ctx, updated), s.classesFor(ctx, updated))
	return api.ClaimPregen200JSONResponse(out), nil
}

// ReleasePregen hands a claimed pregen back to the pool for the next taker.
func (s *Server) ReleasePregen(ctx context.Context, request api.ReleasePregenRequestObject) (api.ReleasePregenResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ReleasePregen401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.ReleasePregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	campaignID, isPregen := pregenCampaign(character)
	// Only a *claimed* pregen can be released. An available one is already in
	// the pool, and a plain hero was never a pregen — both are a 404.
	if !isPregen || character.OwnerUserID == pregenAuthor(character) {
		return api.ReleasePregen404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	// The player who holds it may return it; so may the DM of its table.
	if character.OwnerUserID != uid {
		if _, err := s.requireDM(ctx, campaignID); err != nil {
			switch {
			case errors.Is(err, errNoAuth):
				return api.ReleasePregen401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
			case errors.Is(err, errForbidden):
				return api.ReleasePregen403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
			default:
				return nil, err
			}
		}
	}

	updated, err := s.queries.ReleasePregen(ctx, character.ID)
	if err != nil {
		return nil, err
	}
	authorName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	s.logEvent(ctx, campaignID, uid, "pregen_released",
		fmt.Sprintf("%s is set back on the pregen pool", updated.Name))
	s.publish(campaignID, live.TopicParty)
	out := toAPICharacterWithClass(updated, authorName, uid, s.classDataFor(ctx, updated), s.classesFor(ctx, updated))
	return api.ReleasePregen200JSONResponse(out), nil
}
