DROP INDEX IF EXISTS idx_campaigns_invite_code;
ALTER TABLE campaigns DROP COLUMN IF EXISTS invite_code;
