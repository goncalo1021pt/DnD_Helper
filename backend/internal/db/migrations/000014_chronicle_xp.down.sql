DROP TABLE IF EXISTS campaign_events;
ALTER TABLE characters DROP COLUMN IF EXISTS pending_levels, DROP COLUMN IF EXISTS xp;
ALTER TABLE campaigns DROP COLUMN IF EXISTS progression;
DROP TYPE IF EXISTS progression_mode;
