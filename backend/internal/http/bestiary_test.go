package http

import (
	"reflect"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
)

func TestNormalizeRevealed(t *testing.T) {
	tests := []struct {
		name string
		in   []api.BestiaryEntryPatchRevealed
		want []string
	}{
		{
			name: "keeps valid keys in first-seen order",
			in:   []api.BestiaryEntryPatchRevealed{"lore", "defenses", "offense"},
			want: []string{"lore", "defenses", "offense"},
		},
		{
			name: "de-duplicates",
			in:   []api.BestiaryEntryPatchRevealed{"defenses", "defenses", "lore"},
			want: []string{"defenses", "lore"},
		},
		{
			name: "drops unknown section keys",
			in:   []api.BestiaryEntryPatchRevealed{"defenses", "everything", "hp", "traits"},
			want: []string{"defenses", "traits"},
		},
		{
			name: "empty input yields empty (non-nil) slice",
			in:   nil,
			want: []string{},
		},
		{
			name: "all four sections",
			in:   []api.BestiaryEntryPatchRevealed{"defenses", "traits", "offense", "lore"},
			want: []string{"defenses", "traits", "offense", "lore"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeRevealed(tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("normalizeRevealed(%v) = %v; want %v", tc.in, got, tc.want)
			}
		})
	}
}
