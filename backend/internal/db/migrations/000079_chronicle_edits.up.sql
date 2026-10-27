-- A chronicle line can be put right (#411).
--
-- Until now a line was written once and stood for ever: a typo in a story
-- note, or a player's message in the wrong room, could only be lived with.
-- Who may change what is the handler's business (eventRights); the row only
-- remembers that it was changed, so the feed can say so quietly. A struck
-- line is deleted outright — the event outbox (#315) still holds what was
-- said, and the line undid nothing by being written, so it undoes nothing by
-- going.
ALTER TABLE campaign_events ADD COLUMN edited_at TIMESTAMPTZ;
