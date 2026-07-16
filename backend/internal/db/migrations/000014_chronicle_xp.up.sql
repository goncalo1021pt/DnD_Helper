-- The Chronicle (campaign event ledger) and progression: XP totals on
-- heroes, milestone level allowances, and a per-campaign progression mode.
CREATE TYPE progression_mode AS ENUM ('milestone', 'xp');

ALTER TABLE campaigns
    ADD COLUMN progression progression_mode NOT NULL DEFAULT 'milestone';

ALTER TABLE characters
    ADD COLUMN xp INTEGER NOT NULL DEFAULT 0,
    -- milestone allowances: each DM-declared milestone grants one level-up
    ADD COLUMN pending_levels SMALLINT NOT NULL DEFAULT 0;

CREATE TABLE campaign_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind          TEXT NOT NULL,
    message       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaign_events_feed ON campaign_events(campaign_id, created_at DESC);
