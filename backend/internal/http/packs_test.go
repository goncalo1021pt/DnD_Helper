package http

import "testing"

func strptr(s string) *string { return &s }

// The source stamp an import carries: trimmed, bounded, and absent when the
// pack does not name itself.
func TestPackBook(t *testing.T) {
	long := make([]rune, 100)
	for i := range long {
		long[i] = 'a'
	}
	cases := []struct {
		name string
		in   *string
		want int // rune length of the result
		text string
	}{
		{"nil is no stamp", nil, 0, ""},
		{"empty is no stamp", strptr("   "), 0, ""},
		{"trimmed", strptr("  Xanathar's Guide  "), 16, "Xanathar's Guide"},
		{"bounded at 80", strptr(string(long)), 80, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := packBook(c.in)
			if c.text != "" && got != c.text {
				t.Fatalf("packBook = %q, want %q", got, c.text)
			}
			if len([]rune(got)) != c.want {
				t.Fatalf("packBook = %q (%d runes), want %d runes", got, len([]rune(got)), c.want)
			}
		})
	}
}

// A pack stamps only the entries that do not already know where they are from,
// so re-exporting and re-importing a mixed collection never rewrites history.
func TestStampBook(t *testing.T) {
	cases := []struct {
		name string
		data map[string]interface{}
		book string
		want interface{}
	}{
		{"stamps a bare entry", map[string]interface{}{}, "Xanathar's", "Xanathar's"},
		{"keeps the entry's own book", map[string]interface{}{"book": "Tasha's"}, "Xanathar's", "Tasha's"},
		{"replaces a blank book", map[string]interface{}{"book": "  "}, "Xanathar's", "Xanathar's"},
		{"replaces a non-string book", map[string]interface{}{"book": 7}, "Xanathar's", "Xanathar's"},
		{"an unnamed pack stamps nothing", map[string]interface{}{}, "", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stampBook(c.data, c.book)
			if got := c.data["book"]; got != c.want {
				t.Fatalf("data[book] = %v, want %v", got, c.want)
			}
		})
	}
}
