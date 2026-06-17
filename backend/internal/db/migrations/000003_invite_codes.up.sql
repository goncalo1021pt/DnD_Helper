-- Shareable invite codes so players can join a campaign.

ALTER TABLE campaigns ADD COLUMN invite_code TEXT;

-- Backfill existing campaigns with a random code.
UPDATE campaigns
SET invite_code = upper(substr(md5(random()::text || id::text), 1, 6))
WHERE invite_code IS NULL;

ALTER TABLE campaigns ALTER COLUMN invite_code SET NOT NULL;
CREATE UNIQUE INDEX idx_campaigns_invite_code ON campaigns(invite_code);
