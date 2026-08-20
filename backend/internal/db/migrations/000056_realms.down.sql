DROP INDEX IF EXISTS idx_campaigns_realm;
ALTER TABLE campaigns DROP COLUMN IF EXISTS realm_id;
DROP INDEX IF EXISTS idx_realms_owner;
DROP TABLE IF EXISTS realms;
