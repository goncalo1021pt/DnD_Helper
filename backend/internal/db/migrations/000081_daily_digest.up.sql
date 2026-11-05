-- A daily digest for the chatty events (#339).
--
-- Email is per event: off, now (email_events, as before) or daily
-- (email_digest_events, new). The two never overlap — the server enforces it.
-- The hour is in UTC; the profile converts it to the person's own.
ALTER TABLE users
    ADD COLUMN email_digest_events TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN digest_hour SMALLINT NOT NULL DEFAULT 18 CHECK (digest_hour BETWEEN 0 AND 23);

-- A Discord-format hook (a person's own, or the table's channel) may be daily.
-- A signed Quest Board hook may not: a script wants each event as it happens.
ALTER TABLE webhooks
    ADD COLUMN cadence TEXT NOT NULL DEFAULT 'immediate' CHECK (cadence IN ('immediate', 'daily')),
    ADD COLUMN digest_hour SMALLINT NOT NULL DEFAULT 18 CHECK (digest_hour BETWEEN 0 AND 23),
    ADD CONSTRAINT webhooks_daily_is_discord CHECK (cadence = 'immediate' OR format = 'discord');

-- A digest is one delivery carrying several events.
ALTER TABLE webhook_deliveries ADD COLUMN carries INT NOT NULL DEFAULT 1;

-- The holding pen: an event bound for a digest, its line already rendered at
-- emit time (so the audience and the veil stay the emitter's decision). Claimed
-- by DELETE ... RETURNING, so nothing is sent twice.
CREATE TABLE digest_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    event_id UUID REFERENCES event_outbox(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    line TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT digest_items_one_owner CHECK ((user_id IS NULL) <> (webhook_id IS NULL))
);
CREATE INDEX idx_digest_items_due ON digest_items(due_at);
CREATE INDEX idx_digest_items_user ON digest_items(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_digest_items_hook ON digest_items(webhook_id) WHERE webhook_id IS NOT NULL;
