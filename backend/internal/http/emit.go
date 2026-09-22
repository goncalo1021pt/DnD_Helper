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
// Public is read off the audience: every player at the table in it. The
// sites where that is not the right reading — a reveal, whose audience is
// only the newly told; a hero's level or XP, told to the owner but on the
// roster for all — say so through emitPublic.
func (s *Server) emit(ctx context.Context, campaignID uuid.UUID, name events.Name, audience []uuid.UUID, audErr error, payload any) {
	if s.events == nil {
		return
	}
	public := false
	if audErr == nil {
		p, err := s.coversPlayers(ctx, campaignID, audience)
		if err != nil {
			log.Printf("events: %s in %s: public: %v", name, campaignID, err)
		}
		public = p
	}
	s.emitPublic(ctx, campaignID, name, audience, audErr, public, payload)
}

// emitPublic is emit with publicness decided by the caller (#316).
func (s *Server) emitPublic(ctx context.Context, campaignID uuid.UUID, name events.Name, audience []uuid.UUID, audErr error, public bool, payload any) {
	if s.events == nil {
		return
	}
	if audErr != nil {
		log.Printf("events: %s in %s: audience: %v", name, campaignID, audErr)
		audience = nil
		public = false
	}
	actor, _ := auth.UserID(ctx)
	s.events.Emit(ctx, events.Event{
		Name:     name,
		Campaign: campaignID,
		Actor:    actor,
		Audience: audience,
		Public:   public,
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
