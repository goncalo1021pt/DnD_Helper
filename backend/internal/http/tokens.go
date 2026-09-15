package http

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
)

// API tokens (#294): a door onto a person for scripts, an AI, another service.
//
// A token acts as its owner within the scopes it was minted with (#313) and,
// when it was minted for one, within one table. The three operations here are
// session-only — declared so in the spec, enforced by the scope gate — so a
// leaked token can neither make itself permanent nor lock its owner out.

// maxLiveAPITokens caps how many live tokens one account may hold. Nobody
// needs more; a runaway script minting tokens should hit a wall.
const maxLiveAPITokens = 25

// maxTokenExpiryDays bounds the expiry a token may be minted with. The profile
// offers 30, 90 (its default) and 365; 0 is never.
const maxTokenExpiryDays = 365

func (s *Server) ListApiTokens(ctx context.Context, _ api.ListApiTokensRequestObject) (api.ListApiTokensResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ListApiTokens401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.ListAPITokensByUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.ApiToken, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPIToken(db.ApiToken{
			ID: r.ID, UserID: r.UserID, Name: r.Name, Prefix: r.Prefix, Scopes: r.Scopes,
			CampaignID: r.CampaignID, CreatedAt: r.CreatedAt, LastUsedAt: r.LastUsedAt, ExpiresAt: r.ExpiresAt,
		}, r.CampaignName))
	}
	return api.ListApiTokens200JSONResponse(out), nil
}

func (s *Server) CreateApiToken(ctx context.Context, request api.CreateApiTokenRequestObject) (api.CreateApiTokenResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.CreateApiToken401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if request.Body == nil {
		return api.CreateApiToken400JSONResponse{BadRequestJSONResponse: badRequest("a name and at least one scope are required")}, nil
	}
	in := *request.Body

	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 60 {
		return api.CreateApiToken400JSONResponse{BadRequestJSONResponse: badRequest("name must be 1–60 characters")}, nil
	}

	// Scopes: from the vocabulary, deduplicated, at least one.
	seen := map[auth.Scope]bool{}
	scopes := make([]string, 0, len(in.Scopes))
	for _, raw := range in.Scopes {
		sc, known := auth.ParseScope(string(raw))
		if !known {
			return api.CreateApiToken400JSONResponse{BadRequestJSONResponse: badRequest("unknown scope " + string(raw))}, nil
		}
		if !seen[sc] {
			seen[sc] = true
			scopes = append(scopes, string(sc))
		}
	}
	if len(scopes) == 0 {
		return api.CreateApiToken400JSONResponse{BadRequestJSONResponse: badRequest("at least one scope is required")}, nil
	}

	// The one table, if any: it must be one the owner sits at — a table they
	// do not is answered as if it were not there.
	var campaign pgtype.UUID
	var campaignName *string
	if in.CampaignId != nil {
		id := uuid.UUID(*in.CampaignId)
		if _, err := s.requireMember(ctx, id); err != nil {
			if errors.Is(err, errForbidden) {
				return api.CreateApiToken404JSONResponse{Error: "not found"}, nil
			}
			return nil, err
		}
		c, err := s.queries.GetCampaign(ctx, id)
		if err != nil {
			return nil, err
		}
		campaign = pgtype.UUID{Bytes: id, Valid: true}
		campaignName = &c.Name
	}

	if in.ExpiresInDays < 0 || in.ExpiresInDays > maxTokenExpiryDays {
		return api.CreateApiToken400JSONResponse{BadRequestJSONResponse: badRequest("expiry must be 0 (never) to 365 days")}, nil
	}
	var expires pgtype.Timestamptz
	if in.ExpiresInDays > 0 {
		expires = pgtype.Timestamptz{Time: time.Now().AddDate(0, 0, in.ExpiresInDays), Valid: true}
	}

	live, err := s.queries.CountLiveAPITokensByUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	if live >= maxLiveAPITokens {
		return api.CreateApiToken400JSONResponse{BadRequestJSONResponse: badRequest("too many live tokens — revoke one first")}, nil
	}

	raw, hash, prefix := auth.NewAPIToken()
	row, err := s.queries.CreateAPIToken(ctx, db.CreateAPITokenParams{
		UserID: uid, Name: name, Prefix: prefix, TokenHash: hash,
		Scopes: scopes, CampaignID: campaign, ExpiresAt: expires,
	})
	if err != nil {
		return nil, err
	}

	// The tripwire: tell the account, when it has a confirmed address. Best
	// effort — a mail outage must not stop a token from being minted.
	s.notifyTokenCreated(ctx, uid, name)

	return api.CreateApiToken201JSONResponse{Token: toAPIToken(row, campaignName), Secret: raw}, nil
}

func (s *Server) RevokeApiToken(ctx context.Context, request api.RevokeApiTokenRequestObject) (api.RevokeApiTokenResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.RevokeApiToken401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if _, err := s.queries.RevokeAPIToken(ctx, db.RevokeAPITokenParams{ID: uuid.UUID(request.TokenId), UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.RevokeApiToken404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	return api.RevokeApiToken204Response{}, nil
}

func (s *Server) notifyTokenCreated(ctx context.Context, uid uuid.UUID, tokenName string) {
	if s.mailer == nil {
		return
	}
	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil || !user.EmailVerified || user.Email == nil || *user.Email == "" {
		return
	}
	subject, htmlBody, textBody := mail.TokenCreated(tokenName, strings.TrimRight(s.baseURL, "/")+"/questboard/profile")
	if err := s.mailer.Send(ctx, *user.Email, subject, htmlBody, textBody); err != nil {
		log.Printf("api token: could not send the created-token email to user %s: %v", uid, err)
	}
}

func toAPIToken(row db.ApiToken, campaignName *string) api.ApiToken {
	out := api.ApiToken{
		Id:        openapi_types.UUID(row.ID),
		Name:      row.Name,
		Prefix:    row.Prefix,
		CreatedAt: row.CreatedAt.Time,
	}
	out.Scopes = make([]api.TokenScope, 0, len(row.Scopes))
	for _, sc := range row.Scopes {
		out.Scopes = append(out.Scopes, api.TokenScope(sc))
	}
	if row.CampaignID.Valid {
		id := openapi_types.UUID(uuid.UUID(row.CampaignID.Bytes))
		out.CampaignId = &id
		out.CampaignName = campaignName
	}
	if row.LastUsedAt.Valid {
		t := row.LastUsedAt.Time
		out.LastUsedAt = &t
	}
	if row.ExpiresAt.Valid {
		t := row.ExpiresAt.Time
		out.ExpiresAt = &t
	}
	return out
}

// restrictedTable returns the one table the caller's token was minted for,
// when it was minted for one (#294). A session, or a token minted for every
// table, has none.
func restrictedTable(ctx context.Context) (uuid.UUID, bool) {
	g, ok := auth.GrantOf(ctx)
	if !ok || g.Campaign == nil {
		return uuid.Nil, false
	}
	return *g.Campaign, true
}

// tableAllowed is the campaign restriction's one check, made inside the
// guards every campaign door funnels through (requireMember, requireOwner)
// and at the few doors that are about a hero or the person rather than a
// table. A restricted token asking about another table is answered as the
// guard answers a non-member: refused, and told nothing about it.
func tableAllowed(ctx context.Context, campaignID uuid.UUID) bool {
	only, restricted := restrictedTable(ctx)
	return !restricted || only == campaignID
}
