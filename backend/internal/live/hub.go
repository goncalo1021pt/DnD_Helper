// Package live is the fan-out behind the table's live updates (#109).
//
// The encounter tracker polled every 8 seconds, so a DM advancing a turn was
// news to the players up to 8 seconds later — long enough to be confusing when
// someone is sitting there waiting to act.
//
// This is deliberately the smallest thing that fixes it: a registry of
// subscribers keyed by campaign, and a nudge sent to each of them. What travels
// is a topic — "the encounter moved" — and never the encounter itself.
//
// # Why a nudge and not the data
//
// Almost everything at this table is redacted per viewer. A player sees one
// fight, with hidden combatants dropped and enemy HP flattened to a word; they
// see revealed shops and revealed shelves; they see the places the veil allows.
// A fan-out that pushed state would have to redo every one of those rules per
// subscriber, and the first one anybody forgot would quietly broadcast the DM's
// secrets to the table.
//
// Sending a topic instead means each client re-asks through the endpoint it
// already uses, and the redaction it already passed through happens again. The
// stream cannot leak what it never carries.
package live

import "sync"

// Topic names what changed, coarsely. Clients map a topic to the query keys
// they hold, so these are named after what a player would say happened rather
// than after the table that moved.
type Topic string

const (
	TopicEncounter Topic = "encounter" // a turn advanced, HP moved, someone was revealed
	TopicChronicle Topic = "chronicle" // something was written to the log
	TopicQuests    Topic = "quests"    // a quest was posted, claimed or judged
	TopicMap       Topic = "map"       // fog lifted, a pin moved
	TopicParty     Topic = "party"     // a hero was seated, healed, levelled
	TopicVendors   Topic = "vendors"   // a shop or a shelf was revealed
	TopicNpcs      Topic = "npcs"      // a person or their stats were revealed

	// These two are published into a PERSON's room rather than a campaign's
	// (#181). Friendship and a direct message belong to an account and outlive
	// every table it sits at, so the room they travel in is the account itself.
	TopicFriends  Topic = "friends"  // somebody asked, accepted, parted or blocked
	TopicMessages Topic = "messages" // something was said to you
	TopicTable    Topic = "table"    // your standing at a table changed: the screen given or taken, the table handed over (#299)
)

// buffer is how far behind a client may fall before it is cut loose. Small on
// purpose: these are nudges, and a client that has missed three of them needs
// one more, not the three it missed.
const buffer = 4

// Hub keeps the subscribers of every campaign.
//
// Safe for concurrent use. A single mutex is enough — subscribing is rare, and
// publishing does no work beyond a non-blocking send per subscriber.
type Hub struct {
	mu     sync.Mutex
	rooms  map[string]map[*Subscriber]struct{}
	closed bool
}

// Subscriber is one open stream. Read C until it closes.
type Subscriber struct {
	C  chan Topic
	id string
}

func New() *Hub {
	return &Hub{rooms: map[string]map[*Subscriber]struct{}{}}
}

// Subscribe joins a campaign's room. The returned function leaves it, and is
// safe to call more than once — a stream can end from either side, and both
// ends racing to clean up is the normal case rather than an error.
func (h *Hub) Subscribe(campaignID string) (*Subscriber, func()) {
	sub := &Subscriber{C: make(chan Topic, buffer), id: campaignID}

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		close(sub.C)
		return sub, func() {}
	}
	if h.rooms[campaignID] == nil {
		h.rooms[campaignID] = map[*Subscriber]struct{}{}
	}
	h.rooms[campaignID][sub] = struct{}{}

	var once sync.Once
	return sub, func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if room, ok := h.rooms[campaignID]; ok {
				if _, still := room[sub]; still {
					delete(room, sub)
					close(sub.C)
				}
				if len(room) == 0 {
					delete(h.rooms, campaignID)
				}
			}
		})
	}
}

// Publish nudges everyone watching one campaign.
//
// Never blocks. A subscriber whose buffer is full is one whose connection has
// stalled — a phone that went into a tunnel, a laptop that slept — and the
// alternative to dropping the nudge is holding up the request that caused it.
// The client refetches on reconnect anyway, so a dropped nudge costs a stale
// second, and a blocked publish would cost the DM their turn advancing at all.
func (h *Hub) Publish(campaignID string, topic Topic) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.rooms[campaignID] {
		select {
		case sub.C <- topic:
		default: // behind; it will catch up when it refetches
		}
	}
}

// Subscribers reports how many streams are open on a campaign. For tests and
// for the metrics endpoint.
func (h *Hub) Subscribers(campaignID string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms[campaignID])
}

// Close ends every stream. Used when the server is shutting down, so open
// connections are told rather than left to time out.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	for id, room := range h.rooms {
		for sub := range room {
			close(sub.C)
		}
		delete(h.rooms, id)
	}
}
