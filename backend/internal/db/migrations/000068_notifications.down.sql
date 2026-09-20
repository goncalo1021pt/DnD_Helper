ALTER TABLE memberships DROP COLUMN IF EXISTS muted;
ALTER TABLE users DROP COLUMN IF EXISTS email_events;
DROP INDEX IF EXISTS idx_webhooks_table_channel;
DELETE FROM webhooks WHERE user_id IS NULL;
ALTER TABLE webhooks DROP CONSTRAINT IF EXISTS webhooks_owner_or_table;
ALTER TABLE webhooks ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE webhooks DROP COLUMN IF EXISTS format;
