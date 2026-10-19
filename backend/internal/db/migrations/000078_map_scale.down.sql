ALTER TABLE maps
    DROP CONSTRAINT IF EXISTS maps_scale_whole,
    DROP COLUMN IF EXISTS scale_unit,
    DROP COLUMN IF EXISTS scale_distance;
