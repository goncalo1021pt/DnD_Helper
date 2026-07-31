DROP INDEX IF EXISTS idx_characters_forge_key;

ALTER TABLE characters DROP COLUMN IF EXISTS forge_key;
