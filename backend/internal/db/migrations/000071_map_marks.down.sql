DROP INDEX IF EXISTS idx_map_shapes_mark_seat;
DROP INDEX IF EXISTS idx_map_pins_mark_seat;
ALTER TABLE map_shapes
    DROP CONSTRAINT IF EXISTS map_shapes_mark_whole,
    DROP CONSTRAINT IF EXISTS map_shapes_mark_seat,
    DROP COLUMN IF EXISTS shared,
    DROP COLUMN IF EXISTS campaign_id,
    DROP COLUMN IF EXISTS author_user_id;
ALTER TABLE map_pins
    DROP CONSTRAINT IF EXISTS map_pins_mark_whole,
    DROP CONSTRAINT IF EXISTS map_pins_mark_seat,
    DROP COLUMN IF EXISTS shared,
    DROP COLUMN IF EXISTS campaign_id,
    DROP COLUMN IF EXISTS author_user_id;
