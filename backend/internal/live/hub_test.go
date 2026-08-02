package live

import (
	"sync"
	"testing"
	"time"
)

/*
The fan-out (#109).

Two things here are worth testing and one of them is easy to get wrong under
load rather than under a test: Publish must never block, whatever state a
subscriber is in, because the thing that calls it is the DM's turn advancing.
A hub that blocks on a phone in a tunnel stops the table.

The rest is the plumbing that decides whether a stream leaks: rooms that do not
bleed into each other, and an unsubscribe that is safe from both ends, since a
stream can end because the client left or because the server did.
*/

func recv(t *testing.T, sub *Subscriber) (Topic, bool) {
	t.Helper()
	select {
	case topic, ok := <-sub.C:
		return topic, ok
	case <-time.After(time.Second):
		t.Fatal("nothing arrived within a second")
		return "", false
	}
}

func TestASubscriberHearsItsOwnCampaign(t *testing.T) {
	h := New()
	sub, leave := h.Subscribe("table-a")
	defer leave()

	h.Publish("table-a", TopicEncounter)

	if got, _ := recv(t, sub); got != TopicEncounter {
		t.Errorf("heard %q; want %q", got, TopicEncounter)
	}
}

// The whole point of keying by campaign: one table's turn order is not the
// other table's business, and a stream that heard everything would be a slow
// leak of who is playing what, tonight, where.
func TestOneTableDoesNotHearAnother(t *testing.T) {
	h := New()
	mine, leaveMine := h.Subscribe("table-a")
	defer leaveMine()
	_, leaveTheirs := h.Subscribe("table-b")
	defer leaveTheirs()

	h.Publish("table-b", TopicEncounter)

	select {
	case topic := <-mine.C:
		t.Fatalf("heard %q from another table", topic)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestEveryoneAtTheTableHearsIt(t *testing.T) {
	h := New()
	subs := make([]*Subscriber, 0, 4)
	for i := 0; i < 4; i++ {
		sub, leave := h.Subscribe("table-a")
		defer leave()
		subs = append(subs, sub)
	}
	if n := h.Subscribers("table-a"); n != 4 {
		t.Fatalf("hub reports %d subscribers; want 4", n)
	}

	h.Publish("table-a", TopicChronicle)

	for i, sub := range subs {
		if got, _ := recv(t, sub); got != TopicChronicle {
			t.Errorf("subscriber %d heard %q; want %q", i, got, TopicChronicle)
		}
	}
}

/*
The one that matters under load.

A subscriber whose buffer is full is a connection that has stalled — a phone in
a tunnel, a laptop asleep. Publishing must step over it rather than wait: the
caller is a DM pressing "next turn", and the cost of a dropped nudge is one
stale second, while the cost of a blocked publish is the turn not advancing for
anybody.
*/
func TestAStalledSubscriberNeverHoldsUpTheTable(t *testing.T) {
	h := New()
	stalled, leaveStalled := h.Subscribe("table-a")
	defer leaveStalled()
	live, leaveLive := h.Subscribe("table-a")
	defer leaveLive()

	// Fill the stalled one past its buffer and keep going. Nobody is reading it.
	done := make(chan struct{})
	go func() {
		for i := 0; i < buffer*10; i++ {
			h.Publish("table-a", TopicEncounter)
			// Keep the live subscriber drained so only the stalled one is behind.
			select {
			case <-live.C:
			default:
			}
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked on a subscriber that stopped reading")
	}

	// And the stalled one is still a subscriber — it is behind, not evicted.
	if n := h.Subscribers("table-a"); n != 2 {
		t.Errorf("hub reports %d subscribers; want both still attached", n)
	}
	if len(stalled.C) > buffer {
		t.Errorf("stalled buffer holds %d; want at most %d", len(stalled.C), buffer)
	}
}

func TestLeavingClosesTheStreamAndFreesTheRoom(t *testing.T) {
	h := New()
	sub, leave := h.Subscribe("table-a")
	leave()

	if _, ok := <-sub.C; ok {
		t.Error("the channel should be closed after leaving")
	}
	if n := h.Subscribers("table-a"); n != 0 {
		t.Errorf("room still holds %d; want it emptied", n)
	}
	// Publishing into an empty room is a no-op, not a panic.
	h.Publish("table-a", TopicEncounter)
}

// A stream ends because the client went away or because the server did, and
// both ends racing to clean up is the normal case. Leaving twice must not
// panic on a double close.
func TestLeavingTwiceIsSafe(t *testing.T) {
	h := New()
	_, leave := h.Subscribe("table-a")
	leave()
	leave()
}

func TestClosingTheHubEndsEveryStream(t *testing.T) {
	h := New()
	a, leaveA := h.Subscribe("table-a")
	defer leaveA()
	b, leaveB := h.Subscribe("table-b")
	defer leaveB()

	h.Close()

	if _, ok := <-a.C; ok {
		t.Error("table-a's stream should be closed")
	}
	if _, ok := <-b.C; ok {
		t.Error("table-b's stream should be closed")
	}
	// And a late joiner gets a closed channel rather than one nothing will feed.
	late, leaveLate := h.Subscribe("table-c")
	defer leaveLate()
	if _, ok := <-late.C; ok {
		t.Error("subscribing to a closed hub should hand back a closed stream")
	}
}

// Subscribing and publishing from many goroutines at once is the normal state
// of a busy table, so the race detector gets something to chew on.
func TestConcurrentUse(t *testing.T) {
	h := New()
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sub, leave := h.Subscribe("table-a")
			defer leave()
			h.Publish("table-a", TopicParty)
			select {
			case <-sub.C:
			case <-time.After(time.Second):
			}
		}()
	}
	wg.Wait()
	if n := h.Subscribers("table-a"); n != 0 {
		t.Errorf("%d subscribers left behind; want none", n)
	}
}
