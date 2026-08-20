ALTER TABLE map_pins DROP COLUMN IF EXISTS shape;
DROP INDEX IF EXISTS idx_map_shapes_map;
DROP TABLE IF EXISTS map_shapes;
DROP TYPE IF EXISTS map_shape_kind;
