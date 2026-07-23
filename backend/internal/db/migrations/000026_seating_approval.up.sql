-- Seating approval: when a table bars its door, a hero seats only after the
-- DM approves. A pending request holds the hero at the door; approve seats
-- them, deny (or unseating/withdrawing) clears it. One request per hero.

ALTER TABLE campaigns ADD COLUMN require_seating_approval BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE seat_requests (
    character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seat_requests_campaign ON seat_requests(campaign_id);
