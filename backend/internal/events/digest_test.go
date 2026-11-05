package events

import (
	"testing"
	"time"
)

func TestNextDigest(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct {
		now  string
		hour int
		want string
	}{
		{"2026-11-05T10:00:00Z", 18, "2026-11-05T18:00:00Z"},
		{"2026-11-05T18:00:00Z", 18, "2026-11-06T18:00:00Z"}, // strictly after
		{"2026-11-05T18:00:01Z", 18, "2026-11-06T18:00:00Z"},
		{"2026-12-31T23:30:00Z", 0, "2027-01-01T00:00:00Z"},
		{"2026-11-05T10:00:00+02:00", 18, "2026-11-05T18:00:00Z"}, // now is read in UTC
	}
	for _, c := range cases {
		if got := NextDigest(at(c.now), c.hour); !got.Equal(at(c.want)) {
			t.Errorf("NextDigest(%s, %d) = %s, want %s", c.now, c.hour, got.Format(time.RFC3339), c.want)
		}
	}
}
