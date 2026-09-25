DROP INDEX IF EXISTS idx_map_pins_location;
ALTER TABLE map_pins DROP COLUMN IF EXISTS location_id;
