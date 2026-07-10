-- Enum values cannot be dropped from content_kind without a type rebuild;
-- they are harmless when unused, so only the character columns roll back.
ALTER TABLE characters
    DROP COLUMN IF EXISTS subclass_id,
    DROP COLUMN IF EXISTS feats;
