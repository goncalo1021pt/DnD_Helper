package http

import (
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
The live stream (#109).

The encounter tracker polled every 8 seconds, so a DM advancing a turn was news
to the players up to 8 seconds later — long enough to be confusing when someone
is waiting to act.

Server-Sent Events rather than websockets: it is one long-lived GET on the same
origin, so it rides the session cookie that is already there, needs no second
process, and survives the single-binary-behind-a-tunnel shape this app ships in.

Hand-rolled rather than generated, for the same reason the map image is: the
strict server returns a typed object and is done, and a stream is the opposite
of done. It mounts next to that one, inside the session-aware subrouter, so
membership is checked the same way as everywhere else.

What travels is a topic and never the data. See internal/live for why — almost
everything here is redacted per viewer, and a fan-out carrying state would have
to redo every one of those rules per subscriber.
*/

// streamHeartbeat is how often a comment is written into an idle stream.
//
// Not decoration. A Cloudflare tunnel closes a connection it believes is dead,
// and so does every mobile network between the table and here; a table in a
// quiet scene can easily go minutes without an event. The comment keeps the
// pipe warm and costs two bytes.
const streamHeartbeat = 25 * time.Second

// ServeMeStream opens an SSE stream for one ACCOUNT — the room friendship and
// direct messages travel in (#181). No membership to check: the room is the
// signed-in account itself, and nobody else can subscribe to it.
func (s *Server) ServeMeStream(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s.streamRoom(w, r, "user:"+uid.String())
}

// ServeCampaignStream opens an SSE stream for one campaign's members.
func (s *Server) ServeCampaignStream(w http.ResponseWriter, r *http.Request) {
	campaignID, err := uuid.Parse(chi.URLParam(r, "campaignID"))
	if err != nil {
		http.Error(w, "bad campaign id", http.StatusBadRequest)
		return
	}
	// Same membership check as every other campaign route — a stream is a read,
	// and reads belong to members.
	if _, err := s.requireMember(r.Context(), campaignID); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	s.streamRoom(w, r, campaignID.String())
}

// streamRoom is the stream itself, once. Who may listen is the caller's
// business; keeping the loop in one place is what stops a second door from
// quietly shipping without a heartbeat.
func (s *Server) streamRoom(w http.ResponseWriter, r *http.Request, room string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Nginx and friends buffer a response until it looks finished, which for a
	// stream is never. This asks them not to.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	sub, leave := s.hub.Subscribe(room)
	defer leave()

	// An opening comment so the browser sees bytes and settles the connection
	// before anything interesting happens.
	fmt.Fprint(w, ": listening\n\n")
	flusher.Flush()

	ticker := time.NewTicker(streamHeartbeat)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case topic, open := <-sub.C:
			if !open {
				return // the hub closed: the server is going down
			}
			fmt.Fprintf(w, "event: %s\ndata: {}\n\n", topic)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

// nudge wakes one PERSON's own stream, wherever they happen to be looking.
// Friendship and direct messages belong to an account rather than to a table,
// so their room is the account (#181). Same contract as publish: never blocks,
// never fails, and carries a topic and never the thing that changed.
func (s *Server) nudge(userID uuid.UUID, topic live.Topic) {
	if s.hub != nil {
		s.hub.Publish("user:"+userID.String(), topic)
	}
}

// publish nudges a campaign's watchers. Never blocks, and never fails — a
// change that happened is not undone by nobody hearing about it, so this is
// deliberately not part of any handler's error path.
func (s *Server) publish(campaignID uuid.UUID, topic live.Topic) {
	if s.hub != nil {
		s.hub.Publish(campaignID.String(), topic)
	}
}
