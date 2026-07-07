DELETE FROM characters WHERE campaign_id IS NULL;
DROP INDEX IF EXISTS idx_characters_owner;
ALTER TABLE characters ALTER COLUMN campaign_id SET NOT NULL;
