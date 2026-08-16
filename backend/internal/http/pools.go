package http

/*
Resource pools on the wire (#175).

Which pools a hero has is content's business (rules/pools.go); this file walks
what the hero carries — class, subclass, feats, species, gear — the same way
creatureOptions does, and serves the result already resolved: max computed at
the hero's level, used read off the row, clamped so a shrunken ceiling never
shows more spent than the pool holds.

Pools ride down with the full sheet and with the mutations that change them.
The list endpoints stay light: a roster of eight heroes should not pay five
content lookups apiece for a panel only the open sheet draws.
*/

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// resolvedPool is one pool at this hero's level, ready to serve or to rest.
type resolvedPool struct {
	Name      string
	Max       int
	Used      int
	GrantedBy string
	ShortRest string
}

// poolsUsedIn reads the spent counts off a character row.
func poolsUsedIn(c db.Character) map[string]int {
	used := map[string]int{}
	if len(c.PoolsUsed) > 0 {
		_ = json.Unmarshal(c.PoolsUsed, &used)
	}
	return used
}

// resolvePools gathers every pool the hero's features grant. First declaration
// of a name wins, in the same order grantSources walks: class, subclass,
// species, background, feats, gear. Stale spent counts — a pool no longer
// granted, more uses than the ceiling — read as gone or clamped, not as rot.
func (s *Server) resolvePools(ctx context.Context, c db.Character) []resolvedPool {
	sources := s.grantSources(ctx, c)
	if len(sources) == 0 {
		return nil
	}
	scope := heroScope(c)
	used := poolsUsedIn(c)

	var out []resolvedPool
	seen := map[string]bool{}
	for _, src := range sources {
		// A class's pools are read at the hero's level IN that class — a
		// Cleric 2 / Ranger 1 has a level-2 Channel Divinity and a level-1
		// Favored Enemy, never a level-3 anything (#242). Prof stays the
		// total level's bonus; only the level a table or formula reads moves.
		srcScope := scope
		srcScope.Level = src.levelOr(scope.Level)
		for _, grant := range rules.PoolsIn(src.data) {
			if seen[grant.Name] {
				continue
			}
			seen[grant.Name] = true
			max := grant.Max(srcScope)
			if max <= 0 {
				continue // not at this level, or a declaration gone sour
			}
			u := used[grant.Name]
			if u < 0 {
				u = 0
			}
			if u > max {
				u = max
			}
			out = append(out, resolvedPool{
				Name: grant.Name, Max: max, Used: u,
				GrantedBy: src.name, ShortRest: grant.ShortRestKindAt(srcScope.Level),
			})
		}
	}
	return out
}

// attachPools folds the hero's pools onto an already-serialized sheet.
func attachPools(out *api.Character, pools []resolvedPool) {
	if out.Sheet == nil || len(pools) == 0 {
		return
	}
	list := make([]api.ResourcePool, 0, len(pools))
	for _, p := range pools {
		list = append(list, api.ResourcePool{
			Name: p.Name, Max: p.Max, Used: p.Used,
			GrantedBy: p.GrantedBy, ShortRest: api.ResourcePoolShortRest(p.ShortRest),
		})
	}
	out.Sheet.Pools = &list
}

// SetPools stores uses spent per pool (owner or DM). The map is the whole
// state, the same write-the-lot contract as SetSpellSlots.
func (s *Server) SetPools(ctx context.Context, request api.SetPoolsRequestObject) (api.SetPoolsResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetPools404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireCharacterEditor(ctx, character); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetPools401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetPools403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.SetPoolsResponseObject, error) {
		return api.SetPools400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a pools body is required")
	}

	pools := s.resolvePools(ctx, character)
	if len(pools) == 0 {
		return badRequest("this hero has no resource pools")
	}
	ceiling := map[string]int{}
	for _, p := range pools {
		ceiling[p.Name] = p.Max
	}
	used := map[string]int{}
	for name, u := range request.Body.Used {
		max, ok := ceiling[name]
		if !ok {
			return badRequest("this hero has no pool named " + name)
		}
		if u < 0 || u > max {
			return badRequest("uses spent cannot exceed what the pool holds")
		}
		if u > 0 {
			used[name] = u
		}
	}
	raw, err := json.Marshal(used)
	if err != nil {
		return nil, err
	}

	updated, err := s.queries.SetPoolsUsed(ctx, db.SetPoolsUsedParams{
		ID:        character.ID,
		PoolsUsed: raw,
	})
	if err != nil {
		return nil, err
	}
	ownerName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	uid, _ := auth.UserID(ctx)
	out := toAPICharacterWithClass(updated, ownerName, uid, s.classDataFor(ctx, updated), s.classesFor(ctx, updated))
	attachPools(&out, s.resolvePools(ctx, updated))
	return api.SetPools200JSONResponse(out), nil
}
