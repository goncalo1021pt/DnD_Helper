package http

import (
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
)

// The catalogue lives in one place: the spec's EventName enum is what a
// webhook picker and the docs read, events.All is what the server emits, and
// they must be the same list in the same order.
func TestCatalogueMatchesTheSpec(t *testing.T) {
	spec, err := api.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	schema := spec.Components.Schemas["EventName"]
	if schema == nil || schema.Value == nil {
		t.Fatal("the spec has no EventName schema")
	}
	if len(schema.Value.Enum) != len(events.All) {
		t.Fatalf("spec lists %d events, the server %d", len(schema.Value.Enum), len(events.All))
	}
	for i, v := range schema.Value.Enum {
		if s, _ := v.(string); s != string(events.All[i]) {
			t.Fatalf("at %d: spec says %q, server says %q", i, v, events.All[i])
		}
	}
}

func TestNewly(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	got := newly([]uuid.UUID{a}, []uuid.UUID{a, b, c})
	if len(got) != 2 || got[0] != b || got[1] != c {
		t.Fatalf("after minus before, in order: %v", got)
	}
	if len(newly([]uuid.UUID{a, b}, []uuid.UUID{a, b})) != 0 {
		t.Fatal("nothing new")
	}
	if len(newly(nil, nil)) != 0 {
		t.Fatal("nothing from nothing")
	}
}

func TestExcerpt(t *testing.T) {
	if got := excerpt("short", 140); got != "short" {
		t.Fatal(got)
	}
	long := ""
	for i := 0; i < 50; i++ {
		long += "ção"
	}
	got := excerpt(long, 140)
	if r := []rune(got); len(r) != 141 || r[140] != '…' {
		t.Fatalf("cut at 140 runes plus an ellipsis, got %d runes", len(r))
	}
}
