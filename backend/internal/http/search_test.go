package http

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
)

// Search (#321), the parts that need no database: how text is folded and
// matched, how hits rank, and how a shelf is cut.

func TestSearchIgnoresCaseAndAccents(t *testing.T) {
	cases := []struct {
		text, query string
		want        bool
	}{
		{"Café Lisboa", "cafe", true},
		{"CAFÉ", "café", true},
		{"Strahd von Zarovich", "ZAROV", true},
		{"Ireena Kolyana", "kolyána", true},
		{"Barovia", "ravenloft", false},
		{"Ab", "abc", false},
	}
	for _, c := range cases {
		got := fold(c.text).index(fold(c.query).runes) >= 0
		if got != c.want {
			t.Errorf("%q in %q: got %v, want %v", c.query, c.text, got, c.want)
		}
	}
}

func TestASnippetIsCutFromTheOriginalText(t *testing.T) {
	text := "The innkeeper, a stout dwarf called Brûna, keeps a cellar nobody is allowed into."
	f := fold(text)
	q := fold("bruna").runes
	at := f.index(q)
	if at < 0 {
		t.Fatal("the folded name should be found")
	}
	snip := f.snippet(at, len(q))
	// The accent survives: the words shown are the ones that were written.
	if want := "Brûna"; !strings.Contains(snip, want) {
		t.Fatalf("snippet %q should carry %q as written", snip, want)
	}
	long := fold(fmt.Sprintf("%0300d needle %0300d", 0, 0))
	at = long.index(fold("needle").runes)
	snip = long.snippet(at, 6)
	if !strings.HasPrefix(snip, "…") || !strings.HasSuffix(snip, "…") {
		t.Fatalf("a cut on both sides is marked on both sides: %q", snip)
	}
}

func TestNameHitsRankAboveTextHits(t *testing.T) {
	q := fold("rose").runes
	cs := []candidate{
		{id: uuid.New(), title: "The Inn", body: []string{"A rose grows by the door."}},
		{id: uuid.New(), title: "Primrose Hill"},
		{id: uuid.New(), title: "Rose Durst"},
		{id: uuid.New(), title: "Barovia", body: []string{"Nothing here."}},
	}
	out := api.SearchResults{Counts: map[string]int{}}
	collect(&out, api.HitPerson, cs, q)
	got := []string{}
	for _, h := range out.Hits {
		got = append(got, h.Title)
	}
	want := []string{"Rose Durst", "Primrose Hill", "The Inn"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("order %v, want %v (word start, then contains, then text)", got, want)
	}
	if !out.Hits[0].NameMatch || out.Hits[2].NameMatch || out.Hits[2].Snippet == nil {
		t.Fatalf("a text hit carries a snippet and no name match: %+v", out.Hits[2])
	}
	if out.Counts["person"] != 3 {
		t.Fatalf("counted %d, want 3", out.Counts["person"])
	}
}

func TestAShelfIsCutAtEightButCountedWhole(t *testing.T) {
	var cs []candidate
	for i := 0; i < 20; i++ {
		cs = append(cs, candidate{id: uuid.New(), title: fmt.Sprintf("Goblin %d", i)})
	}
	out := api.SearchResults{Counts: map[string]int{}}
	collect(&out, api.HitBestiary, cs, fold("goblin").runes)
	if len(out.Hits) != searchPerKind || out.Counts["bestiary"] != 20 {
		t.Fatalf("got %d hits counted %d; want %d hits counted 20", len(out.Hits), out.Counts["bestiary"], searchPerKind)
	}
}

func TestAShortQueryFindsOnlyTheStartOfAWord(t *testing.T) {
	cs := []candidate{
		{id: uuid.New(), title: "Vallaki"},
		{id: uuid.New(), title: "Valley of the Raven"},
		{id: uuid.New(), title: "Deva"},
		{id: uuid.New(), title: "Unseen Servant", body: []string{"A vague shape."}},
	}
	out := api.SearchResults{Counts: map[string]int{}}
	collect(&out, api.HitPlace, cs, fold("va").runes)
	got := []string{}
	for _, h := range out.Hits {
		got = append(got, h.Title)
	}
	if fmt.Sprint(got) != fmt.Sprint([]string{"Vallaki", "Valley of the Raven"}) {
		t.Fatalf("two letters found %v; only names with a word starting with them belong", got)
	}
}

func TestASnippetCutsOnWholeWords(t *testing.T) {
	text := "The bones were taken from the church below the Blue Water Inn, and nobody has seen them since the feast."
	f := fold(text)
	at := f.index(fold("blue water").runes)
	snip := f.snippet(at, len([]rune("blue water")))
	words := strings.Fields(strings.Trim(snip, "…"))
	for _, w := range []string{words[0], words[len(words)-1]} {
		if !strings.Contains(text, " "+w) && !strings.HasPrefix(text, w) {
			t.Fatalf("snippet %q starts or ends mid-word at %q", snip, w)
		}
	}
	if !strings.Contains(snip, "Blue Water Inn") {
		t.Fatalf("snippet %q lost the match", snip)
	}
}
