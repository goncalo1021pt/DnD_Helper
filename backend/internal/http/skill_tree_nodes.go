package http

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// The powers in a web, and the wiring between them.
//
// Edges are undirected and stored once: SetEdges orders each pair by id and
// drops duplicates before writing, so "A connects to B" and "B connects to A"
// cannot both exist and later disagree about the same connection. It replaces
// the whole edge list in one transaction rather than diffing it — a web left
// half-rewired is not a web.

func (s *Server) CreateNode(ctx context.Context, request api.CreateNodeRequestObject) (api.CreateNodeResponseObject, error) {
	tree, err := s.queries.GetTree(ctx, uuid.UUID(request.TreeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.CreateNode404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, tree.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateNode401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateNode403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	in, errMsg := validateNodeInput(request.Body)
	if errMsg != "" {
		return api.CreateNode400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	node, err := s.queries.CreateNode(ctx, db.CreateNodeParams{
		TreeID:      tree.ID,
		Name:        in.name,
		Description: in.description,
		Tradeoff:    in.tradeoff,
		Rarity:      in.rarity,
		Limb:        in.limb,
		IsEntry:     in.isEntry,
		PosX:        in.posX,
		PosY:        in.posY,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateNode201JSONResponse(toAPINode(node)), nil
}

func (s *Server) UpdateNode(ctx context.Context, request api.UpdateNodeRequestObject) (api.UpdateNodeResponseObject, error) {
	node, err := s.queries.GetNode(ctx, uuid.UUID(request.NodeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateNode404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	tree, err := s.queries.GetTree(ctx, node.TreeID)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireDM(ctx, tree.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateNode401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateNode403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	in, errMsg := validateNodeInput(request.Body)
	if errMsg != "" {
		return api.UpdateNode400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	updated, err := s.queries.UpdateNode(ctx, db.UpdateNodeParams{
		ID:          node.ID,
		Name:        in.name,
		Description: in.description,
		Tradeoff:    in.tradeoff,
		Rarity:      in.rarity,
		Limb:        in.limb,
		IsEntry:     in.isEntry,
		PosX:        in.posX,
		PosY:        in.posY,
	})
	if err != nil {
		return nil, err
	}
	return api.UpdateNode200JSONResponse(toAPINode(updated)), nil
}

func (s *Server) DeleteNode(ctx context.Context, request api.DeleteNodeRequestObject) (api.DeleteNodeResponseObject, error) {
	node, err := s.queries.GetNode(ctx, uuid.UUID(request.NodeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteNode404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	tree, err := s.queries.GetTree(ctx, node.TreeID)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireDM(ctx, tree.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteNode401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteNode403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteNode(ctx, node.ID); err != nil {
		return nil, err
	}
	return api.DeleteNode204Response{}, nil
}

func (s *Server) SetEdges(ctx context.Context, request api.SetEdgesRequestObject) (api.SetEdgesResponseObject, error) {
	tree, err := s.queries.GetTree(ctx, uuid.UUID(request.TreeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetEdges404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, tree.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetEdges401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetEdges403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetEdges400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "an edge list is required"}}, nil
	}

	// Every edge must connect two distinct nodes of this tree.
	nodes, err := s.queries.ListNodesByTree(ctx, tree.ID)
	if err != nil {
		return nil, err
	}
	valid := make(map[uuid.UUID]bool, len(nodes))
	for _, n := range nodes {
		valid[n.ID] = true
	}
	type pair struct{ a, b uuid.UUID }
	seen := map[pair]bool{}
	edges := make([]pair, 0, len(request.Body.Edges))
	for _, e := range request.Body.Edges {
		a, b := uuid.UUID(e.A), uuid.UUID(e.B)
		if a == b || !valid[a] || !valid[b] {
			return api.SetEdges400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "edges must connect two distinct nodes of this tree",
			}}, nil
		}
		// Undirected: normalize so each connection is stored once.
		if strings.Compare(a.String(), b.String()) > 0 {
			a, b = b, a
		}
		p := pair{a, b}
		if !seen[p] {
			seen[p] = true
			edges = append(edges, p)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	if err := qtx.DeleteEdgesForTree(ctx, tree.ID); err != nil {
		return nil, err
	}
	for _, p := range edges {
		if err := qtx.AddEdge(ctx, db.AddEdgeParams{TreeID: tree.ID, NodeA: p.a, NodeB: p.b}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	detail, err := s.buildTreeDetail(ctx, tree)
	if err != nil {
		return nil, err
	}
	return api.SetEdges200JSONResponse(detail), nil
}

type nodeInput struct {
	name        string
	description string
	tradeoff    *string
	rarity      db.NodeRarity
	limb        string
	isEntry     bool
	posX        *float32
	posY        *float32
}

func validateNodeInput(body *api.SkillNodeInput) (nodeInput, string) {
	if body == nil {
		return nodeInput{}, "a node body is required"
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > 80 {
		return nodeInput{}, "name must be between 1 and 80 characters"
	}
	in := nodeInput{name: name, rarity: db.NodeRarity(string(body.Rarity))}
	if in.rarity != db.NodeRarityMinor && in.rarity != db.NodeRarityKeystone {
		return nodeInput{}, "rarity must be minor or keystone"
	}
	if body.Description != nil {
		in.description = strings.TrimSpace(*body.Description)
	}
	if body.Tradeoff != nil {
		t := strings.TrimSpace(*body.Tradeoff)
		if t != "" {
			in.tradeoff = &t
		}
	}
	if body.Limb != nil {
		limb := strings.TrimSpace(*body.Limb)
		if len([]rune(limb)) > 40 {
			return nodeInput{}, "limb must be at most 40 characters"
		}
		in.limb = limb
	}
	if body.IsEntry != nil {
		in.isEntry = *body.IsEntry
	}
	in.posX = body.PosX
	in.posY = body.PosY
	return in, ""
}

func toAPINode(n db.SkillNode) api.SkillNode {
	return api.SkillNode{
		Id:          n.ID,
		TreeId:      n.TreeID,
		Name:        n.Name,
		Description: n.Description,
		Tradeoff:    n.Tradeoff,
		Rarity:      api.NodeRarity(string(n.Rarity)),
		Limb:        n.Limb,
		IsEntry:     n.IsEntry,
		PosX:        n.PosX,
		PosY:        n.PosY,
	}
}
