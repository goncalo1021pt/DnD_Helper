package webhooks

import (
	"context"
	"log"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// QueueDueDigests turns every daily hook's due lines into deliveries (#339):
// one message per hook, one embed per table. The lines are claimed by
// deleting them in the same transaction that writes the delivery, so a crash
// between the two loses neither, and nothing is ever queued twice. A hook
// with nothing due is never touched, so a digest with nothing in it sends
// nothing. Returns how many deliveries it queued.
func (s *Service) QueueDueDigests(ctx context.Context) int {
	if err := s.q.DropDisabledHookDigest(ctx); err != nil {
		log.Printf("webhooks: digest sweep: %v", err)
	}
	hooks, err := s.q.ListWebhooksWithDueDigest(ctx)
	if err != nil {
		log.Printf("webhooks: digest hooks: %v", err)
		return 0
	}
	queued := 0
	for _, id := range hooks {
		n, err := s.queueDigest(ctx, id)
		if err != nil {
			log.Printf("webhooks: digest for %s: %v", id, err)
			continue
		}
		queued += n
	}
	return queued
}

func (s *Service) queueDigest(ctx context.Context, hook uuid.UUID) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	rows, err := qtx.ClaimHookDigest(ctx, pgtype.UUID{Bytes: hook, Valid: true})
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	var tables []DigestTable
	at := map[uuid.UUID]int{}
	for _, r := range rows {
		i, ok := at[r.CampaignID]
		if !ok {
			i = len(tables)
			at[r.CampaignID] = i
			tables = append(tables, DigestTable{ID: r.CampaignID, Name: r.CampaignName})
		}
		tables[i].Lines = append(tables[i].Lines, r.Line)
	}
	bodies, carries, err := discordDigests(tables, s.opts.BaseURL)
	if err != nil {
		return 0, err
	}
	for i, body := range bodies {
		if _, err := qtx.InsertWebhookDigestDelivery(ctx, db.InsertWebhookDigestDeliveryParams{WebhookID: hook, Body: body, Carries: int32(carries[i])}); err != nil {
			return 0, err
		}
	}
	return len(bodies), tx.Commit(ctx)
}
