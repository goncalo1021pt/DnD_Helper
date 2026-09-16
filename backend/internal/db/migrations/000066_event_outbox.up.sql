-- The event catalogue's outbox (#315): every emitted event, with the audience
-- the emitter decided and the payload it carried. The audit log of a table,
-- the DM's feed, and the queue a delivering subscriber (#295) reads from.
-- "events" was already taken by the chronicle's narrative lines.
CREATE TABLE event_outbox (
    id UUID PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    audience UUID[] NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_outbox_campaign ON event_outbox(campaign_id, created_at DESC);
