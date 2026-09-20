-- Notifications that reach you outside the app (#316).
--
-- A Discord channel is a webhook wearing a different body: `format` says
-- whether a hook receives the signed catalogue envelope or a Discord message
-- shaped for an incoming webhook. Same worker, same retries, same log.
ALTER TABLE webhooks ADD COLUMN format TEXT NOT NULL DEFAULT 'questboard'
    CHECK (format IN ('questboard', 'discord'));

-- The table's own channel is a hook with no owner and one table — set by
-- a DM in campaign settings, at most one per table. Having no owner, it is
-- selected by the table rather than by the audience, and hears only what
-- the WHOLE table hears: a handout to one hero or a seat request never
-- reaches the shared channel.
ALTER TABLE webhooks ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE webhooks ADD CONSTRAINT webhooks_owner_or_table
    CHECK (user_id IS NOT NULL OR campaign_id IS NOT NULL);
CREATE UNIQUE INDEX idx_webhooks_table_channel ON webhooks(campaign_id) WHERE user_id IS NULL;

-- Which events reach a person's inbox. NULL is the defaults — the next
-- gathering, and a handout to them — until they say otherwise; an empty
-- array is none, which is what the unsubscribe link writes.
ALTER TABLE users ADD COLUMN email_events TEXT[];

-- A table a person has muted: no email about it, whatever they chose above.
-- It is a fact about the membership, so leaving the table drops it.
ALTER TABLE memberships ADD COLUMN muted BOOLEAN NOT NULL DEFAULT false;
