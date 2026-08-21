package http

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

// Server implements the generated api.StrictServerInterface.
type Server struct {
	pool     *pgxpool.Pool
	queries  *db.Queries
	fogCache *fogImageCache
	// hub fans live nudges out to open streams (#109). Never nil in a running
	// server; a nil hub simply means nobody is listening, which is what the
	// unit tests construct.
	hub *live.Hub
}

func NewServer(pool *pgxpool.Pool) *Server {
	return &Server{
		pool: pool, queries: db.New(pool),
		fogCache: newFogImageCache(), hub: live.New(),
	}
}

// Hub exposes the fan-out so the router can close it on shutdown.
func (s *Server) Hub() *live.Hub { return s.hub }

// GetHealth reports liveness and database reachability.
func (s *Server) GetHealth(ctx context.Context, _ api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	if err := s.pool.Ping(ctx); err != nil {
		return api.GetHealth503JSONResponse{Status: api.Degraded}, nil
	}
	return api.GetHealth200JSONResponse{Status: api.Ok}, nil
}

// GetCurrentUser returns the authenticated user and their campaign memberships.
func (s *Server) GetCurrentUser(ctx context.Context, _ api.GetCurrentUserRequestObject) (api.GetCurrentUserResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.GetCurrentUser401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}

	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return api.GetCurrentUser401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	memberships, err := s.listMemberships(ctx, uid)
	if err != nil {
		return nil, err
	}

	return api.GetCurrentUser200JSONResponse{
		User:      toAPIUser(user),
		Campaigns: memberships,
	}, nil
}

// ListCampaigns returns the campaigns the caller belongs to.
func (s *Server) ListCampaigns(ctx context.Context, _ api.ListCampaignsRequestObject) (api.ListCampaignsResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListCampaigns401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	memberships, err := s.listMemberships(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.ListCampaigns200JSONResponse(memberships), nil
}

// CreateCampaign creates a campaign and makes the caller its DM.
func (s *Server) CreateCampaign(ctx context.Context, request api.CreateCampaignRequestObject) (api.CreateCampaignResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.CreateCampaign401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}

	name := ""
	if request.Body != nil {
		name = strings.TrimSpace(request.Body.Name)
	}
	if name == "" || len([]rune(name)) > 120 {
		return api.CreateCampaign400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "name must be between 1 and 120 characters",
		}}, nil
	}

	// Found it on ground you already have, or on ground of its own (#233).
	// Absent is the default and is what every table did before realms existed.
	var realmID uuid.UUID
	if request.Body != nil && request.Body.RealmId != nil {
		realmID = uuid.UUID(*request.Body.RealmId)
		if realmID != uuid.Nil {
			realm, err := s.queries.GetRealm(ctx, realmID)
			// Somebody else's realm is answered as no realm at all, so the
			// door cannot be used to find out whose settings exist.
			if err != nil || realm.OwnerUserID != uid {
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return nil, err
				}
				return api.CreateCampaign400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
					Error: "that realm is not one of yours",
				}}, nil
			}
		}
	}

	// Retry on the (rare) chance of an invite-code collision.
	for attempt := 0; attempt < 5; attempt++ {
		campaign, err := s.createCampaignTx(ctx, name, uid, generateInviteCode(), realmID)
		if err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return nil, err
		}
		metrics.CampaignCreated()
		// Whoever creates a table is its DM, and needs the code to fill it.
		out, err := s.campaignOut(ctx, campaign, true)
		if err != nil {
			return nil, err
		}
		return api.CreateCampaign201JSONResponse(out), nil
	}
	return nil, errors.New("could not generate a unique invite code")
}

// createCampaignTx atomically creates a campaign, the realm it stands on when
// it is founding its own, and the owner's DM membership. All three or none:
// a campaign with no realm cannot exist, the column says so, and a realm minted
// for a campaign that then failed to appear would be a container nobody made.
func (s *Server) createCampaignTx(ctx context.Context, name string, uid uuid.UUID, code string, realmID uuid.UUID) (db.Campaign, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Campaign{}, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	if realmID == uuid.Nil {
		realm, err := realmOfItsOwn(ctx, qtx, name, uid)
		if err != nil {
			return db.Campaign{}, err
		}
		realmID = realm.ID
	}

	campaign, err := qtx.CreateCampaign(ctx, db.CreateCampaignParams{
		Name: name, OwnerUserID: uid, InviteCode: code, RealmID: realmID,
	})
	if err != nil {
		return db.Campaign{}, err
	}
	if _, err := qtx.AddMembership(ctx, db.AddMembershipParams{
		UserID:     uid,
		CampaignID: campaign.ID,
		Role:       db.MembershipRoleDm,
	}); err != nil {
		return db.Campaign{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Campaign{}, err
	}
	return campaign, nil
}

// JoinCampaign adds the caller as a player using a campaign invite code.
func (s *Server) JoinCampaign(ctx context.Context, request api.JoinCampaignRequestObject) (api.JoinCampaignResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.JoinCampaign401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	code := ""
	if request.Body != nil {
		code = normalizeInviteCode(request.Body.Code)
	}
	if code == "" {
		return api.JoinCampaign400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "an invite code is required",
		}}, nil
	}

	campaign, err := s.queries.GetCampaignByInviteCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.JoinCampaign404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	banned, err := s.queries.IsBanned(ctx, db.IsBannedParams{CampaignID: campaign.ID, UserID: uid})
	if err != nil {
		return nil, err
	}
	if banned {
		return api.JoinCampaign403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{
			Error: "you have been barred from this table",
		}}, nil
	}
	if err := s.queries.JoinCampaign(ctx, db.JoinCampaignParams{UserID: uid, CampaignID: campaign.ID}); err != nil {
		return nil, err
	}
	m, err := s.queries.GetMembership(ctx, db.GetMembershipParams{UserID: uid, CampaignID: campaign.ID})
	if err != nil {
		return nil, err
	}
	joined, err := s.campaignOut(ctx, campaign, false)
	if err != nil {
		return nil, err
	}
	// A player walks in holding the code; that is not a reason to hand them a
	// copy of it to keep and pass on.
	return api.JoinCampaign200JSONResponse{
		Campaign: joined,
		Role:     toAPIRole(m.Role),
	}, nil
}

// RegenerateInvite issues a fresh invite code for a campaign (DM only).
func (s *Server) RegenerateInvite(ctx context.Context, request api.RegenerateInviteRequestObject) (api.RegenerateInviteResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.RegenerateInvite404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.RegenerateInvite401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.RegenerateInvite403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	for attempt := 0; attempt < 5; attempt++ {
		campaign, err := s.queries.RegenerateInviteCode(ctx, db.RegenerateInviteCodeParams{
			ID: campaignID, InviteCode: generateInviteCode(),
		})
		if err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return nil, err
		}
		// Gated on requireDM above, and the new code is the whole answer.
		out, err := s.campaignOut(ctx, campaign, true)
		if err != nil {
			return nil, err
		}
		return api.RegenerateInvite200JSONResponse(out), nil
	}
	return nil, errors.New("could not generate a unique invite code")
}

// DeleteCampaign permanently strikes a campaign (DM only). Seated heroes
// return to My Heroes; everything else scoped to the campaign — quests, the
// chronicle, codex, maps, encounters, memberships, bans — is gone with it.
func (s *Server) DeleteCampaign(ctx context.Context, request api.DeleteCampaignRequestObject) (api.DeleteCampaignResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.queries.GetCampaign(ctx, campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteCampaign404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteCampaign401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteCampaign403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}

	if err := s.deleteCampaignTx(ctx, campaignID); err != nil {
		return nil, err
	}
	return api.DeleteCampaign204Response{}, nil
}

// deleteCampaignTx atomically returns seated heroes to My Heroes (table-born
// ones die with the table, matching a kick) before striking the campaign row;
// everything else cascades from the foreign key.
func (s *Server) deleteCampaignTx(ctx context.Context, campaignID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)

	// Read the ground before the table goes, so the realm can be judged after.
	campaign, err := qtx.GetCampaign(ctx, campaignID)
	if err != nil {
		return err
	}

	cid := pgUUID(campaignID)
	if err := qtx.DeleteTableBornOfCampaign(ctx, cid); err != nil {
		return err
	}
	// The Folk die with the table, and so do the sheets forged for them (#227):
	// a body has no owner's shelf to return to.
	if err := qtx.DeleteNpcBodiesOfCampaign(ctx, cid); err != nil {
		return err
	}
	if err := qtx.UnseatCharactersOfCampaign(ctx, cid); err != nil {
		return err
	}
	if err := qtx.DeleteCampaign(ctx, campaignID); err != nil {
		return err
	}
	// Disbanding leaves the ground behind, and an unnamed realm is nothing but
	// the dead campaign's name — it would go on offering itself in the "found
	// a table here" picker forever (#233). A realm the owner NAMED outlives
	// its campaigns on purpose: that is where the next one on this ground
	// begins, which is the whole reason the container exists.
	if err := sweepUnnamedRealm(ctx, qtx, campaign.RealmID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Server) listMemberships(ctx context.Context, uid uuid.UUID) ([]api.CampaignMembership, error) {
	rows, err := s.queries.ListCampaignsForUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.CampaignMembership, 0, len(rows))
	for _, row := range rows {
		// The call this issue was about: one listing serving both roles, per
		// row. A player's row carries no code — which is what makes a ban
		// mean something, since a banned member cannot hand on what they were
		// never given.
		campaign := toAPICampaign(db.Campaign{
			ID:                     row.ID,
			Name:                   row.Name,
			OwnerUserID:            row.OwnerUserID,
			CreatedAt:              row.CreatedAt,
			InviteCode:             row.InviteCode,
			NextSessionAt:          row.NextSessionAt,
			Progression:            row.Progression,
			MaxLevel:               row.MaxLevel,
			RequireSeatingApproval: row.RequireSeatingApproval,
			MaxSeatedPerPlayer:     row.MaxSeatedPerPlayer,
			HiddenSheets:           row.HiddenSheets,
			RealmID:                row.RealmID,
			Coinage:                row.Coinage,
		}, row.Role == db.MembershipRoleDm)
		campaign.RealmName = row.RealmName
		out = append(out, api.CampaignMembership{
			Campaign: campaign,
			Role:     toAPIRole(row.Role),
		})
	}
	return out, nil
}

// tsPtr converts a nullable pg timestamp to the API's optional time.
func tsPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

func toAPIUser(u db.User) api.User {
	return api.User{
		Id:            u.ID,
		Name:          u.Name,
		Email:         u.Email,
		Image:         u.Image,
		Provider:      u.Provider,
		EmailVerified: u.EmailVerified,
		TwofaEnabled:  u.TotpEnabled,
		CreatedAt:     u.CreatedAt.Time,
	}
}

// toAPICampaign renders a campaign for one reader.
//
// forDM is a required argument rather than a default, and that is the whole
// point of it: the invite code used to ride along unconditionally, so every
// player's GET /campaigns carried the code that admits anyone holding it. The
// UI only drew it for the DM, which reads as safe and is not — a kicked or
// banned player still had it out of the payload, which made the ban partly
// decorative (#207). Making the caller say who is reading turns "did anyone
// think about this call site?" into a compile error.
func toAPICampaign(c db.Campaign, forDM bool) api.Campaign {
	var maxLevel *int
	if c.MaxLevel != nil {
		v := int(*c.MaxLevel)
		maxLevel = &v
	}
	maxSeated := int(c.MaxSeatedPerPlayer)
	out := api.Campaign{
		Id:                     c.ID,
		Name:                   c.Name,
		OwnerUserId:            c.OwnerUserID,
		CreatedAt:              c.CreatedAt.Time,
		NextSessionAt:          tsPtr(c.NextSessionAt),
		Progression:            (*api.CampaignProgression)(ptrString(string(c.Progression))),
		MaxLevel:               maxLevel,
		RequireSeatingApproval: &c.RequireSeatingApproval,
		MaxSeatedPerPlayer:     &maxSeated,
		HiddenSheets:           &c.HiddenSheets,
		RealmId:                c.RealmID,
	}
	// Absent means the standard ladder, but everyone reads the same list —
	// a client that had to know the default would be a second place for the
	// coins to be defined (#195).
	coins := toAPICoins(coinageOf(c.Coinage))
	out.Coinage = &coins
	if forDM {
		code := c.InviteCode
		out.InviteCode = &code
	}
	return out
}

// campaignOut shapes a campaign for the wire, naming the realm it stands on
// (#233). The name is not on the campaign row, and the listing gets it from a
// join — so every OTHER path goes through here rather than each remembering to
// look it up, which is how `realmName` would quietly come back empty from one
// settings toggle and not another.
func (s *Server) campaignOut(ctx context.Context, c db.Campaign, forDM bool) (api.Campaign, error) {
	out := toAPICampaign(c, forDM)
	realm, err := s.queries.GetRealm(ctx, c.RealmID)
	if err != nil {
		return api.Campaign{}, err
	}
	out.RealmName = realm.Name
	return out, nil
}

// campaignCeiling is the highest level heroes may reach at this table.
func campaignCeiling(c db.Campaign) int {
	if c.MaxLevel != nil {
		return int(*c.MaxLevel)
	}
	return 20
}

func ptrString(s string) *string { return &s }

func toAPIRole(r db.MembershipRole) api.Role {
	if r == db.MembershipRoleDm {
		return api.Dm
	}
	return api.Player
}

func unauthorized() api.UnauthorizedJSONResponse {
	return api.UnauthorizedJSONResponse{Error: "authentication required"}
}
