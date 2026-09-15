package events

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// Store is the built-in subscriber: every event lands in event_outbox. That
// row is three things at once — the audit log of what happened at a table,
// the DM's feed, and the durable queue a delivering subscriber (#295) reads
// from so a webhook that was down does not mean an event that never was.
//
// Best effort, off the request's cancellation: a client that hung up after
// the write must not un-happen the event, and a failed insert is logged, never
// returned — an event is the second thing that happens, and the first has
// already happened.
func Store(q *db.Queries) Subscriber {
	return func(ctx context.Context, e Event) {
		payload := []byte("{}")
		if e.Payload != nil {
			b, err := json.Marshal(e.Payload)
			if err != nil {
				log.Printf("events: %s payload: %v", e.Name, err)
				return
			}
			payload = b
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		audience := e.Audience
		if audience == nil {
			audience = []uuid.UUID{}
		}
		if err := q.InsertOutboxEvent(ctx, db.InsertOutboxEventParams{
			ID:          e.ID,
			CampaignID:  e.Campaign,
			Name:        string(e.Name),
			ActorUserID: pgtype.UUID{Bytes: e.Actor, Valid: e.Actor != uuid.Nil},
			Audience:    audience,
			Payload:     payload,
			CreatedAt:   pgtype.Timestamptz{Time: e.At, Valid: true},
		}); err != nil {
			log.Printf("events: store %s in %s: %v", e.Name, e.Campaign, err)
		}
	}
}
