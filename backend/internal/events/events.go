// Package events is the catalogue (#315): named events with a payload and an
// audience, emitted once from the handler after the write, and handed to
// whoever subscribed — the outbox here, the webhooks of #295, the
// notifications of #316.
//
// The live layer stays a nudge: a topic carries nothing, and the browser
// refetches through its own veil. An event has to SAY what happened, because a
// webhook or an email has nobody to refetch — and so it also has to say who
// may hear it. The audience is decided by the emitter, which knows the veil,
// never by a subscriber, which does not; a subscriber can only filter down.
package events

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Name is what happened. The vocabulary is mirrored by the EventName enum in
// the spec, which is what a webhook picker and the docs read from; a test
// holds the two together.
type Name string

const (
	QuestPosted      Name = "quest.posted"      // a notice reached the board for someone
	QuestClaimed     Name = "quest.claimed"     // a member took it up
	QuestCompleted   Name = "quest.completed"   // the DM marked it done
	HandoutGiven     Name = "handout.given"     // a prop reached someone for the first time
	SessionScheduled Name = "session.scheduled" // the next gathering was set, where there was none
	SessionMoved     Name = "session.moved"     // the next gathering changed date
	HeroLevelled     Name = "hero.levelled"     // a seated hero rose a level
	HeroXPAwarded    Name = "hero.xp_awarded"   // the DM granted (or docked) XP
	EncounterStarted Name = "encounter.started" // a fight went live
	EncounterEnded   Name = "encounter.ended"   // a fight stood down
	ChronicleWritten Name = "chronicle.written" // somebody wrote in the chronicle
	MemberJoined     Name = "member.joined"     // somebody walked in with the invite code
	SeatRequested    Name = "seat.requested"    // a player asked the DM for a seat
)

// All is the catalogue in one place, in the order the docs list it.
var All = []Name{
	QuestPosted, QuestClaimed, QuestCompleted,
	HandoutGiven,
	SessionScheduled, SessionMoved,
	HeroLevelled, HeroXPAwarded,
	EncounterStarted, EncounterEnded,
	ChronicleWritten,
	MemberJoined,
	SeatRequested,
}

// Event is one thing that happened at one table.
type Event struct {
	ID       uuid.UUID
	Name     Name
	At       time.Time
	Campaign uuid.UUID
	// Actor is who did it; uuid.Nil when nobody in particular.
	Actor uuid.UUID
	// Audience is who may hear it — user ids, because an email or a webhook
	// reaches a person, resolved by the emitter through the thing's own veil.
	Audience []uuid.UUID
	// Public is whether every player at the table may know this — decided by
	// the emitter, like the audience, because only it knows the veil. It is
	// not the same as "everyone is in the audience": a reveal announces only
	// to the newly told, and a level-up is told to the owner and the DMs
	// though the roster shows it to all. The table's shared channel (#316)
	// posts only what is public.
	Public bool
	// Payload is ids plus the names a reader needs, never the whole row; one
	// of the *EventPayload shapes in the spec, by Name.
	Payload any
}

// Subscriber takes an event and returns. Queueing, retrying and delivering
// are its own business — Emit will not wait, and must not be made to.
type Subscriber func(ctx context.Context, e Event)

// Bus fans one Emit out to every Subscriber, in the order they registered.
// A nil Bus is a valid one that nobody listens to, so a Server built without
// one (as in tests) emits into silence rather than guarding every site.
type Bus struct {
	mu   sync.RWMutex
	subs []Subscriber
}

func New() *Bus { return &Bus{} }

func (b *Bus) Subscribe(fn Subscriber) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs = append(b.subs, fn)
}

// Emit stamps the event and hands it to every subscriber. A subscriber that
// panics is logged and skipped; it never takes the others, or the handler that
// emitted, down with it.
func (b *Bus) Emit(ctx context.Context, e Event) {
	if b == nil {
		return
	}
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	if e.At.IsZero() {
		e.At = time.Now()
	}
	b.mu.RLock()
	subs := append([]Subscriber(nil), b.subs...)
	b.mu.RUnlock()
	for _, fn := range subs {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("events: subscriber panicked on %s: %v", e.Name, r)
				}
			}()
			fn(ctx, e)
		}()
	}
}
