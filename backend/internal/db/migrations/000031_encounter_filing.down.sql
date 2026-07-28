DROP INDEX IF EXISTS idx_encounters_campaign_tag;
DROP INDEX IF EXISTS idx_encounters_location;

ALTER TABLE encounters
    DROP COLUMN IF EXISTS location_id,
    DROP COLUMN IF EXISTS tag;
