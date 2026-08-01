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

// Skill trees — "webs", at the table. A DM draws one per campaign: a graph of
// powers where each node costs picks and each edge says what can be reached
// from what. A hero binds to exactly one web (their pact) and spends granted
// picks walking outward from an entry node.
//
// This file is the web itself — creating, renaming and deleting one, and
// rendering it for the client. The powers and the wiring between them live in
// skill_tree_nodes.go; the pact and the spending live in skill_tree_picks.go.

func (s *Server) ListTrees(ctx context.Context, request api.ListTreesRequestObject) (api.ListTreesResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireMember(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListTrees401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListTrees403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	trees, err := s.queries.ListTreesByCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	out := make([]api.SkillTree, 0, len(trees))
	for _, t := range trees {
		out = append(out, toAPITree(t))
	}
	return api.ListTrees200JSONResponse(out), nil
}

func (s *Server) CreateTree(ctx context.Context, request api.CreateTreeRequestObject) (api.CreateTreeResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	in, errMsg := validateTreeInput(request.Body)
	if errMsg != "" {
		return api.CreateTree400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	tree, err := s.queries.CreateTree(ctx, db.CreateTreeParams{
		CampaignID:       campaignID,
		Name:             in.name,
		Description:      in.description,
		KeystonePickCost: in.keystonePickCost,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateTree201JSONResponse(toAPITree(tree)), nil
}

func (s *Server) GetTree(ctx context.Context, request api.GetTreeRequestObject) (api.GetTreeResponseObject, error) {
	tree, err := s.queries.GetTree(ctx, uuid.UUID(request.TreeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetTree404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireMember(ctx, tree.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	detail, err := s.buildTreeDetail(ctx, tree)
	if err != nil {
		return nil, err
	}
	return api.GetTree200JSONResponse(detail), nil
}

func (s *Server) UpdateTree(ctx context.Context, request api.UpdateTreeRequestObject) (api.UpdateTreeResponseObject, error) {
	tree, err := s.queries.GetTree(ctx, uuid.UUID(request.TreeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.UpdateTree404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, tree.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	in, errMsg := validateTreeInput(request.Body)
	if errMsg != "" {
		return api.UpdateTree400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: errMsg}}, nil
	}
	updated, err := s.queries.UpdateTree(ctx, db.UpdateTreeParams{
		ID:               tree.ID,
		Name:             in.name,
		Description:      in.description,
		KeystonePickCost: in.keystonePickCost,
	})
	if err != nil {
		return nil, err
	}
	return api.UpdateTree200JSONResponse(toAPITree(updated)), nil
}

func (s *Server) DeleteTree(ctx context.Context, request api.DeleteTreeRequestObject) (api.DeleteTreeResponseObject, error) {
	tree, err := s.queries.GetTree(ctx, uuid.UUID(request.TreeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.DeleteTree404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireDM(ctx, tree.CampaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if err := s.queries.DeleteTree(ctx, tree.ID); err != nil {
		return nil, err
	}
	return api.DeleteTree204Response{}, nil
}

type treeInput struct {
	name             string
	description      string
	keystonePickCost int32
}

func validateTreeInput(body *api.SkillTreeInput) (treeInput, string) {
	if body == nil {
		return treeInput{}, "a tree body is required"
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > 80 {
		return treeInput{}, "name must be between 1 and 80 characters"
	}
	desc := ""
	if body.Description != nil {
		desc = strings.TrimSpace(*body.Description)
	}
	cost := int32(1)
	if body.KeystonePickCost != nil {
		if *body.KeystonePickCost < 1 || *body.KeystonePickCost > 5 {
			return treeInput{}, "keystone pick cost must be between 1 and 5"
		}
		cost = int32(*body.KeystonePickCost)
	}
	return treeInput{name: name, description: desc, keystonePickCost: cost}, ""
}

func (s *Server) buildTreeDetail(ctx context.Context, tree db.SkillTree) (api.SkillTreeDetail, error) {
	nodes, err := s.queries.ListNodesByTree(ctx, tree.ID)
	if err != nil {
		return api.SkillTreeDetail{}, err
	}
	edges, err := s.queries.ListEdgesByTree(ctx, tree.ID)
	if err != nil {
		return api.SkillTreeDetail{}, err
	}
	detail := api.SkillTreeDetail{
		Tree:  toAPITree(tree),
		Nodes: make([]api.SkillNode, 0, len(nodes)),
		Edges: make([]api.SkillEdge, 0, len(edges)),
	}
	for _, n := range nodes {
		detail.Nodes = append(detail.Nodes, toAPINode(n))
	}
	for _, e := range edges {
		detail.Edges = append(detail.Edges, api.SkillEdge{A: e.NodeA, B: e.NodeB})
	}
	return detail, nil
}

func toAPITree(t db.SkillTree) api.SkillTree {
	return api.SkillTree{
		Id:               t.ID,
		CampaignId:       t.CampaignID,
		Name:             t.Name,
		Description:      t.Description,
		KeystonePickCost: int(t.KeystonePickCost),
		CreatedAt:        t.CreatedAt.Time,
	}
}
