DROP TABLE IF EXISTS digest_items;
ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS carries;
ALTER TABLE webhooks
    DROP CONSTRAINT IF EXISTS webhooks_daily_is_discord,
    DROP COLUMN IF EXISTS digest_hour,
    DROP COLUMN IF EXISTS cadence;
ALTER TABLE users DROP COLUMN IF EXISTS digest_hour, DROP COLUMN IF EXISTS email_digest_events;
