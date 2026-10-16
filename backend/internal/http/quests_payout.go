package http

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
A quest pays (#395). Its rewards were words on a notice that never reached
anyone; now a gold reward is an amount in the table's coin and an item reward
names a thing, and when the quest is done the DM pays them out — one gift per
hero, through the same pack-filling the gift door uses (#394), so a purse that
would overfill or a pack that unpacks behaves the same wherever it came from.

Paying is a separate step from completing: marking a quest done is a status and
must never fail on a purse, so the payout is its own door, and the quest
records that it paid (`paid_at`, claimed by the first update to set it) so
re-opening and re-completing it cannot pay twice. A reward that does not read as
goods — reputation, "other", gold in words — stays words, shown as not payable.
*/

// rewardGold is a gold reward's amount in base units; ok is false when the value
// does not read as an amount in this table's coin.
func rewardGold(r db.QuestReward, ladder Coinage) (int64, bool) {
	if r.Type != db.RewardTypeGold || r.Value == nil {
		return 0, false
	}
	amount, msg := parseGiftCoin(*r.Value, ladder)
	return amount, msg == "" && amount > 0
}

// rewardItemName is what an item reward hands over when it names no armory
// entry: the value, which is where the editor has always put the name.
func rewardItemName(r db.QuestReward) string {
	if r.Value != nil && strings.TrimSpace(*r.Value) != "" {
		return strings.TrimSpace(*r.Value)
	}
	return ""
}

// rewardPayable says whether a payout can hand this reward over.
func rewardPayable(r db.QuestReward, ladder Coinage) bool {
	switch r.Type {
	case db.RewardTypeGold:
		_, ok := rewardGold(r, ladder)
		return ok
	case db.RewardTypeItem:
		return r.ItemID.Valid || rewardItemName(r) != ""
	}
	return false
}

func (s *Server) PayOutQuest(ctx context.Context, request api.PayOutQuestRequestObject) (api.PayOutQuestResponseObject, error) {
	questID := uuid.UUID(request.QuestId)
	quest, err := s.queries.GetQuest(ctx, questID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.PayOutQuest404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	dm, err := s.requireDM(ctx, quest.CampaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.PayOutQuest401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.PayOutQuest403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	bad := func(msg string) (api.PayOutQuestResponseObject, error) {
		return api.PayOutQuest400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	conflict := func(msg string) (api.PayOutQuestResponseObject, error) {
		return api.PayOutQuest409JSONResponse{Error: msg}, nil
	}
	if request.Body == nil {
		return bad("a payout body is required")
	}
	body := request.Body
	if quest.Status != db.QuestStatusCompleted {
		return conflict("only a completed quest pays out")
	}
	if quest.PaidAt.Valid {
		return conflict("this quest has already paid out")
	}

	campaign, err := s.queries.GetCampaign(ctx, quest.CampaignID)
	if err != nil {
		return nil, err
	}
	ladder := coinageOf(campaign.Coinage)
	rewards, err := s.queries.ListRewardsForQuest(ctx, questID)
	if err != nil {
		return nil, err
	}

	// Seated here, each named once.
	rows, err := s.queries.ListCharactersByCampaign(ctx, pgUUID(quest.CampaignID))
	if err != nil {
		return nil, err
	}
	seated := map[uuid.UUID]bool{}
	for _, row := range rows {
		seated[row.ID] = true
	}

	// The gold: every payable gold reward, summed, then divided or repeated.
	var goldTotal int64
	for _, r := range rewards {
		if amount, ok := rewardGold(r, ladder); ok {
			goldTotal += amount
		}
	}
	var goldHeroes []uuid.UUID
	if body.HeroIds != nil {
		seen := map[uuid.UUID]bool{}
		for _, id := range *body.HeroIds {
			hero := uuid.UUID(id)
			if !seated[hero] {
				return bad("a chosen hero is not seated at this table")
			}
			if !seen[hero] {
				seen[hero] = true
				goldHeroes = append(goldHeroes, hero)
			}
		}
	}
	if goldTotal > 0 && len(goldHeroes) == 0 {
		return bad("choose who shares the gold")
	}
	each := goldTotal
	remainder := int64(0)
	if goldTotal > 0 && (body.GoldMode == nil || string(*body.GoldMode) != "each") {
		each = goldTotal / int64(len(goldHeroes))
		remainder = goldTotal % int64(len(goldHeroes))
	}
	coinFor := map[uuid.UUID]int64{}
	for _, h := range goldHeroes {
		coinFor[h] = each
	}

	// The items: each payable one goes to exactly one hero, said by the DM.
	named := map[uuid.UUID]uuid.UUID{}
	if body.Items != nil {
		for _, it := range *body.Items {
			if !seated[uuid.UUID(it.HeroId)] {
				return bad("a chosen hero is not seated at this table")
			}
			named[uuid.UUID(it.RewardId)] = uuid.UUID(it.HeroId)
		}
	}
	linesFor := map[uuid.UUID][]giftLine{}
	var contentIDs []uuid.UUID
	var lib itemLibrary
	paysSomething := goldTotal > 0
	for _, r := range rewards {
		if r.Type != db.RewardTypeItem || !rewardPayable(r, ladder) {
			continue
		}
		hero, ok := named[r.ID]
		if !ok {
			return bad("choose who receives " + rewardItemLabel(r))
		}
		var cid *uuid.UUID
		var name *string
		if r.ItemID.Valid {
			id := uuid.UUID(r.ItemID.Bytes)
			cid = &id
		} else {
			n := rewardItemName(r)
			name = &n
		}
		line, msg, err := s.giftLineFor(ctx, dm.UserID, ladder, cid, name, r.Qty, &lib)
		if err != nil {
			return nil, err
		}
		if msg != "" {
			return bad(msg)
		}
		if line.contentID.Valid {
			contentIDs = append(contentIDs, uuid.UUID(line.contentID.Bytes))
		}
		linesFor[hero] = append(linesFor[hero], line)
		paysSomething = true
	}
	if !paysSomething {
		return bad("this quest has no rewards a payout can hand over")
	}
	blockers, err := s.codexBlockers(ctx, quest.CampaignID, contentIDs)
	if err != nil {
		return nil, err
	}
	if len(blockers) > 0 {
		return bad(blockers[0].row.Name + " is not admitted by this table's codex — rule on it first")
	}

	// Every hero's pack changes together, and the quest is marked, or nothing is.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	qtx := s.queries.WithTx(tx)
	if _, err := qtx.MarkQuestPaid(ctx, questID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return conflict("this quest has already paid out")
		}
		return nil, err
	}
	var targets []uuid.UUID
	seenTarget := map[uuid.UUID]bool{}
	for _, h := range append(append([]uuid.UUID{}, goldHeroes...), keysOf(linesFor)...) {
		if !seenTarget[h] {
			seenTarget[h] = true
			targets = append(targets, h)
		}
	}
	for _, hero := range targets {
		var stock []giftLine
		for _, l := range linesFor[hero] {
			stock = append(stock, l.toStock()...)
		}
		msg, err := fillPack(ctx, qtx, hero, stock, coinFor[hero], ladder)
		if err != nil {
			return nil, err
		}
		if msg != "" {
			return bad(msg)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// One gift's worth of saying per hero, as the gift door does.
	announce := body.Announce == nil || *body.Announce
	note := fmt.Sprintf("reward for %q", quest.Title)
	for _, hero := range targets {
		s.sayGift(ctx, quest.CampaignID, dm.UserID, []uuid.UUID{hero}, rows, linesFor[hero], coinFor[hero], ladder, &note, announce, "")
	}

	out := api.QuestPayout{Heroes: make([]api.Character, 0, len(targets))}
	for _, hero := range targets {
		c, err := s.queries.GetCharacter(ctx, hero)
		if err != nil {
			return nil, err
		}
		name, err := s.ownerName(ctx, c.OwnerUserID)
		if err != nil {
			return nil, err
		}
		out.Heroes = append(out.Heroes, toAPICharacterWithClass(c, name, dm.UserID, s.classDataFor(ctx, c), s.classesFor(ctx, c)))
	}
	if remainder > 0 {
		t := formatCoins(remainder, ladder)
		out.Remainder = &t
	}
	if out.Quest, err = s.buildOneQuest(ctx, questID); err != nil {
		return nil, err
	}
	s.publish(quest.CampaignID, live.TopicQuests)
	return api.PayOutQuest200JSONResponse(out), nil
}

func rewardItemLabel(r db.QuestReward) string {
	if n := rewardItemName(r); n != "" {
		return n
	}
	return r.Label
}

func keysOf(m map[uuid.UUID][]giftLine) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out
}
