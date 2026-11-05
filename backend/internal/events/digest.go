package events

import "time"

// DigestSuited are the events a daily digest is for (#339): the chatty ones,
// where a message each is a flood. The profile suggests daily for them; it is
// a suggestion, never a default.
var DigestSuited = []Name{ChronicleWritten, HeroXPAwarded, QuestClaimed}

// NextDigest is the next moment the given UTC hour strikes, strictly after
// now. An item held at 18:00 sharp waits for tomorrow's, not for itself.
func NextDigest(now time.Time, hour int) time.Time {
	now = now.UTC()
	t := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, time.UTC)
	if !t.After(now) {
		t = t.AddDate(0, 0, 1)
	}
	return t
}
