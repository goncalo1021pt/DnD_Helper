package http

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// --- trees ---

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

// --- nodes & edges ---

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

// --- the pact ---

func (s *Server) GetCharacterTree(ctx context.Context, request api.GetCharacterTreeRequestObject) (api.GetCharacterTreeResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GetCharacterTree404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	campaignID, seated := seatedCampaign(character)
	if !seated {
		// An unseated hero's web is dormant: visible to the owner as "no pact".
		uid, ok := auth.UserID(ctx)
		if !ok {
			return api.GetCharacterTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		}
		if uid != character.OwnerUserID {
			return api.GetCharacterTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		}
		return api.GetCharacterTree200JSONResponse(api.CharacterTreeState{Assigned: false}), nil
	}
	if _, err := s.requireMember(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetCharacterTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetCharacterTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	state, err := s.buildCharacterTreeState(ctx, character)
	if err != nil {
		return nil, err
	}
	return api.GetCharacterTree200JSONResponse(state), nil
}

func (s *Server) SetCharacterTree(ctx context.Context, request api.SetCharacterTreeRequestObject) (api.SetCharacterTreeResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetCharacterTree404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	campaignID, seated := seatedCampaign(character)
	if !seated {
		return api.SetCharacterTree400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the hero is not seated at a campaign",
		}}, nil
	}
	if _, err := s.requireDM(ctx, campaignID); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SetCharacterTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SetCharacterTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.SetCharacterTree400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a treeId is required"}}, nil
	}
	tree, err := s.queries.GetTree(ctx, uuid.UUID(request.Body.TreeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SetCharacterTree404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if tree.CampaignID != campaignID {
		return api.SetCharacterTree400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the tree belongs to another campaign",
		}}, nil
	}

	// A changed pact resets progress: picks return to zero, nodes are unlearned.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	if existing, err := qtx.GetPact(ctx, character.ID); err == nil && existing.TreeID != tree.ID {
		if err := qtx.DeletePicksForCharacter(ctx, character.ID); err != nil {
			return nil, err
		}
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if _, err := qtx.SetPact(ctx, db.SetPactParams{CharacterID: character.ID, TreeID: tree.ID}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	state, err := s.buildCharacterTreeState(ctx, character)
	if err != nil {
		return nil, err
	}
	return api.SetCharacterTree200JSONResponse(state), nil
}

func (s *Server) GrantPicks(ctx context.Context, request api.GrantPicksRequestObject) (api.GrantPicksResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GrantPicks404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	grantCampaign, grantSeated := seatedCampaign(character)
	if !grantSeated {
		return api.GrantPicks400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the hero is not seated at a campaign",
		}}, nil
	}
	if _, err := s.requireDM(ctx, grantCampaign); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GrantPicks401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GrantPicks403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil || request.Body.Picks < 1 || request.Body.Picks > 10 {
		return api.GrantPicks400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "picks must be between 1 and 10",
		}}, nil
	}
	if _, err := s.queries.GetPact(ctx, character.ID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.GrantPicks400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "the character has no pact — bind a tree first",
			}}, nil
		}
		return nil, err
	}
	if _, err := s.queries.GrantPicks(ctx, db.GrantPicksParams{
		CharacterID:  character.ID,
		PicksGranted: int32(request.Body.Picks),
	}); err != nil {
		return nil, err
	}
	state, err := s.buildCharacterTreeState(ctx, character)
	if err != nil {
		return nil, err
	}
	return api.GrantPicks200JSONResponse(state), nil
}

func (s *Server) SpendPick(ctx context.Context, request api.SpendPickRequestObject) (api.SpendPickResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SpendPick404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	spendCampaign, spendSeated := seatedCampaign(character)
	if !spendSeated {
		return api.SpendPick400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "the hero is not seated at a campaign",
		}}, nil
	}
	member, err := s.requireMember(ctx, spendCampaign)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SpendPick401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.SpendPick403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	// Spending is the player's choice — their character, or the DM's table.
	if member.UserID != character.OwnerUserID && member.Role != db.MembershipRoleDm {
		return api.SpendPick403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if request.Body == nil {
		return api.SpendPick400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a nodeId is required"}}, nil
	}

	badRequest := func(msg string) (api.SpendPickResponseObject, error) {
		return api.SpendPick400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}

	pact, err := s.queries.GetPact(ctx, character.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return badRequest("the character has no pact — bind a tree first")
		}
		return nil, err
	}
	node, err := s.queries.GetNode(ctx, uuid.UUID(request.Body.NodeId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.SpendPick404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if node.TreeID != pact.TreeID {
		return badRequest("that power belongs to another tree")
	}
	tree, err := s.queries.GetTree(ctx, pact.TreeID)
	if err != nil {
		return nil, err
	}
	taken, err := s.queries.ListPickedNodes(ctx, character.ID)
	if err != nil {
		return nil, err
	}
	takenSet := make(map[uuid.UUID]bool, len(taken))
	spent := 0
	for _, t := range taken {
		if t.ID == node.ID {
			return badRequest("that power is already claimed")
		}
		takenSet[t.ID] = true
		spent += nodeCost(t.Rarity, tree.KeystonePickCost)
	}
	cost := nodeCost(node.Rarity, tree.KeystonePickCost)
	if int(pact.PicksGranted)-spent < cost {
		return badRequest("not enough unspent picks")
	}

	// Reachability: an entry node, or adjacent to a power already claimed.
	if !node.IsEntry {
		edges, err := s.queries.ListEdgesByTree(ctx, tree.ID)
		if err != nil {
			return nil, err
		}
		reachable := false
		for _, e := range edges {
			if (e.NodeA == node.ID && takenSet[e.NodeB]) || (e.NodeB == node.ID && takenSet[e.NodeA]) {
				reachable = true
				break
			}
		}
		if !reachable {
			return badRequest("that power is out of reach — the web must lead to it")
		}
	}

	if err := s.queries.AddPick(ctx, db.AddPickParams{CharacterID: character.ID, NodeID: node.ID}); err != nil {
		return nil, err
	}
	state, err := s.buildCharacterTreeState(ctx, character)
	if err != nil {
		return nil, err
	}
	return api.SpendPick200JSONResponse(state), nil
}

// --- helpers ---

func nodeCost(rarity db.NodeRarity, keystoneCost int32) int {
	if rarity == db.NodeRarityKeystone {
		return int(keystoneCost)
	}
	return 1
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

func (s *Server) buildCharacterTreeState(ctx context.Context, character db.Character) (api.CharacterTreeState, error) {
	pact, err := s.queries.GetPact(ctx, character.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.CharacterTreeState{Assigned: false}, nil
		}
		return api.CharacterTreeState{}, err
	}
	tree, err := s.queries.GetTree(ctx, pact.TreeID)
	if err != nil {
		return api.CharacterTreeState{}, err
	}
	detail, err := s.buildTreeDetail(ctx, tree)
	if err != nil {
		return api.CharacterTreeState{}, err
	}
	taken, err := s.queries.ListPickedNodes(ctx, character.ID)
	if err != nil {
		return api.CharacterTreeState{}, err
	}
	spent := 0
	takenIds := make([]uuid.UUID, 0, len(taken))
	for _, t := range taken {
		spent += nodeCost(t.Rarity, tree.KeystonePickCost)
		takenIds = append(takenIds, t.ID)
	}
	granted := int(pact.PicksGranted)
	remaining := granted - spent
	return api.CharacterTreeState{
		Assigned:       true,
		Tree:           &detail,
		PicksGranted:   &granted,
		PicksSpent:     &spent,
		PicksRemaining: &remaining,
		TakenNodeIds:   &takenIds,
	}, nil
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
