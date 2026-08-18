DROP INDEX IF EXISTS idx_characters_campaign_kind;
ALTER TABLE characters DROP COLUMN kind;
DROP TYPE character_kind;
