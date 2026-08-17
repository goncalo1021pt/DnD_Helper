package http

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// The pact: binding a hero to one web, and spending their way across it.
//
// Two rules decide every spend, and both are quiet when wrong — a refused pick
// reads as "the DM drew the web that way" and an allowed one reads as nothing
// at all. So both are named functions with tests rather than loops inside the
// handler:
//
//   - what the web has already cost. Keystones are charged the tree's own
//     price, everything else costs one, and the total is what stands between a
//     hero and the next power.
//   - what is in reach. An entry node, or a node with an edge to something
//     already claimed. Edges are undirected, so both ends have to be checked;
//     looking at one would strand half of every web depending on which way the
//     DM happened to draw the connection.

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
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.GetCharacterTree401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.GetCharacterTree403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	// A hero's web is their sheet by another name — the table's veil covers it.
	veil, err := s.loadSheetVeil(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if veil.concealsFrom(character.ID, character.OwnerUserID, member.UserID, member.Role == db.MembershipRoleDm) {
		return api.GetCharacterTree403JSONResponse{ForbiddenJSONResponse: veiledSheet()}, nil
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
	for _, t := range taken {
		if t.ID == node.ID {
			return badRequest("that power is already claimed")
		}
		takenSet[t.ID] = true
	}
	cost := nodeCost(node.Rarity, tree.KeystonePickCost)
	if int(pact.PicksGranted)-picksSpent(taken, tree.KeystonePickCost) < cost {
		return badRequest("not enough unspent picks")
	}

	// An entry node is reachable by definition; anything else has to hang off
	// something already claimed. The edges are only worth loading in that case.
	if !node.IsEntry {
		edges, err := s.queries.ListEdgesByTree(ctx, tree.ID)
		if err != nil {
			return nil, err
		}
		if !withinReach(node.ID, edges, takenSet) {
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

// --- the two rules --------------------------------------------------------

// nodeCost is what one power costs. A keystone is charged whatever the tree
// asks for it; everything else is a single pick.
func nodeCost(rarity db.NodeRarity, keystoneCost int32) int {
	if rarity == db.NodeRarityKeystone {
		return int(keystoneCost)
	}
	return 1
}

// picksSpent totals what a hero's claimed powers have already cost them.
//
// Every caller wants the same number for the same reason — granted minus this
// is what the hero has left — so it is one function rather than a loop repeated
// wherever the answer is needed. Two of them disagreeing would show up as a
// remaining count that funds a power the spend then refuses.
func picksSpent(taken []db.SkillNode, keystoneCost int32) int {
	spent := 0
	for _, t := range taken {
		spent += nodeCost(t.Rarity, keystoneCost)
	}
	return spent
}

// withinReach reports whether the web leads to a node: is it adjacent to any
// power already claimed?
//
// Edges are undirected and stored one way round only — SetEdges normalises each
// pair by id order — so a claimed power can be on either end of the row and
// both have to be checked. Testing only one end would strand roughly half of
// every web, and which half would depend on nothing but the uuids the nodes
// happened to be given.
//
// Entry nodes are the caller's business: they are reachable with no web at all.
func withinReach(nodeID uuid.UUID, edges []db.SkillEdge, taken map[uuid.UUID]bool) bool {
	for _, e := range edges {
		if e.NodeA == nodeID && taken[e.NodeB] {
			return true
		}
		if e.NodeB == nodeID && taken[e.NodeA] {
			return true
		}
	}
	return false
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
	spent := picksSpent(taken, tree.KeystonePickCost)
	takenIds := make([]uuid.UUID, 0, len(taken))
	for _, t := range taken {
		takenIds = append(takenIds, t.ID)
	}
	granted := int(pact.PicksGranted)
	// Spent is recomputed at TODAY'S prices, so a DM raising the keystone
	// cost after a claim could push a hero into debt — "Picks -1 of 1" with
	// the next grant silently swallowed. A reprice never creates debt: the
	// ledger clamps at zero (#248).
	if spent > granted {
		spent = granted
	}
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
