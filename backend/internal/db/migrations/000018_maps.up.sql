-- The Map: campaign atlases stored in the database itself, so one pg_dump
-- carries the whole world. A campaign holds one or more maps; sub-maps hang
-- off a parent (overworld → locals) and region pins jump between them.
CREATE TABLE maps (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    -- The map this one is a detail of; NULL for an overworld. SET NULL keeps
    -- orphaned locals reachable from the atlas list if the parent is struck.
    parent_map_id UUID REFERENCES maps(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    image         BYTEA NOT NULL,
    content_type  TEXT NOT NULL,
    width         INT NOT NULL,
    height        INT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_maps_campaign ON maps(campaign_id);

-- Pins live at fractions of the image (0..1 in both axes) so they survive
-- any zoom, viewport, or screen. A pin with link_map_id is a region marker
-- that leads into a sub-map; dm_only pins never reach player payloads.
CREATE TABLE map_pins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id      UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    x           DOUBLE PRECISION NOT NULL,
    y           DOUBLE PRECISION NOT NULL,
    dm_only     BOOLEAN NOT NULL DEFAULT false,
    link_map_id UUID REFERENCES maps(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_map_pins_map ON map_pins(map_id);
