-- Map layers (#355): named groups of ink the viewer can switch off.
--
-- A layer belongs to a map, and so to the ground (#234): it is drawn the same
-- at every table on the realm, like the pins and shapes it holds. Which layers
-- a viewer has open is theirs alone and lives in their browser; the server
-- keeps only what the DM authored.
--
-- `position` is the drawing order — higher paints above — with the base map
-- (pins and shapes in no layer) always beneath every layer. `shown_by_default`
-- is how a viewer first sees the layer, a suggestion they may overrule.
-- `dm_only` is the one gate: a DM-only layer and everything filed in it is
-- absent from a player's payload, a second veil on top of each item's own
-- flag, exactly as a DM-only pin is.
CREATE TABLE map_layers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id           UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    position         INTEGER NOT NULL,
    shown_by_default BOOLEAN NOT NULL DEFAULT TRUE,
    dm_only          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_map_layers_map ON map_layers(map_id, position);

-- Striking a layer drops what was filed in it to the base map, never with it:
-- a layer is a folder, not the ink.
ALTER TABLE map_pins ADD COLUMN layer_id UUID REFERENCES map_layers(id) ON DELETE SET NULL;
ALTER TABLE map_shapes ADD COLUMN layer_id UUID REFERENCES map_layers(id) ON DELETE SET NULL;
CREATE INDEX idx_map_pins_layer ON map_pins(layer_id);
CREATE INDEX idx_map_shapes_layer ON map_shapes(layer_id);
