DROP INDEX IF EXISTS idx_map_shapes_layer;
DROP INDEX IF EXISTS idx_map_pins_layer;
ALTER TABLE map_shapes DROP COLUMN IF EXISTS layer_id;
ALTER TABLE map_pins DROP COLUMN IF EXISTS layer_id;
DROP INDEX IF EXISTS idx_map_layers_map;
DROP TABLE IF EXISTS map_layers;
