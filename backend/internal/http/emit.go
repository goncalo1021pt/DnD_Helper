package http

import (
	"context"
	"log"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
)

// emit puts an event on the catalogue (#315), beside the nudge the handler
// already publishes. The actor is whoever is asking. An audience that could
// not be resolved is logged and the event is still recorded — for nobody —
// rather than lost: the audit log must not have a hole where a read failed.
func (s *Server) emit(ctx context.Context, campaignID uuid.UUID, name events.Name, audience []uuid.UUID, audErr error, payload any) {
	if s.events == nil {
		return
	}
	if audErr != nil {
		log.Printf("events: %s in %s: audience: %v", name, campaignID, audErr)
		audience = nil
	}
	actor, _ := auth.UserID(ctx)
	s.events.Emit(ctx, events.Event{
		Name:     name,
		Campaign: campaignID,
		Actor:    actor,
		Audience: audience,
		Payload:  payload,
	})
}

// excerpt is the first n runes of a line, with an ellipsis when it was cut.
func excerpt(text string, n int) string {
	r := []rune(text)
	if len(r) <= n {
		return text
	}
	return string(r[:n]) + "…"
}
