-- Characters become account-level: they belong to a user and are optionally
-- "seated" at one campaign (campaign_id NULL = resting in My Heroes).
ALTER TABLE characters ALTER COLUMN campaign_id DROP NOT NULL;
CREATE INDEX idx_characters_owner ON characters(owner_user_id);
