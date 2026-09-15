package events

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestEmitReachesEverySubscriberInOrder(t *testing.T) {
	bus := New()
	var order []string
	bus.Subscribe(func(_ context.Context, e Event) { order = append(order, "first:"+string(e.Name)) })
	bus.Subscribe(func(_ context.Context, _ Event) { panic("a subscriber with a bug") })
	bus.Subscribe(func(_ context.Context, e Event) { order = append(order, "third:"+string(e.Name)) })

	campaign := uuid.New()
	bus.Emit(context.Background(), Event{Name: QuestPosted, Campaign: campaign})

	if len(order) != 2 || order[0] != "first:quest.posted" || order[1] != "third:quest.posted" {
		t.Fatalf("a panicking subscriber is skipped, not fatal: %v", order)
	}
}

func TestEmitStampsIdAndTime(t *testing.T) {
	bus := New()
	var got Event
	bus.Subscribe(func(_ context.Context, e Event) { got = e })
	bus.Emit(context.Background(), Event{Name: MemberJoined})
	if got.ID == uuid.Nil || got.At.IsZero() {
		t.Fatalf("an emitted event carries an id and a time: %+v", got)
	}
}

func TestNilBusIsSilence(t *testing.T) {
	var bus *Bus
	bus.Emit(context.Background(), Event{Name: SeatRequested}) // must not panic
}

func TestAllIsTheWholeVocabulary(t *testing.T) {
	seen := map[Name]bool{}
	for _, n := range All {
		if seen[n] {
			t.Fatalf("%s listed twice", n)
		}
		seen[n] = true
		if n == "" {
			t.Fatal("an empty name")
		}
	}
	if len(All) != 13 {
		t.Fatalf("the first list is thirteen events; %d listed — if you added one, the spec enum and docs/API.md need it too", len(All))
	}
}
