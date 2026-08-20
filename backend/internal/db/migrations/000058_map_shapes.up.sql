-- Roads and realms drawn on the map (#262).
--
-- Two asks from the table that look like different features and are the same
-- one: "a continuous brush to make a line, so we can draw streets", and "split
-- the map into zones, each with a coloured hue for which kingdom it is". Both
-- are an ordered run of points on the image. What differs is only whether the
-- run is STROKED along or FILLED in, so one table serves both and a single
-- drawing tool learns one gesture.
--
-- Points are normalised the way a pin's x/y already are — fractions of the
-- image, 0..1 — so a shape survives the map being re-hung at another size.
-- They live in JSONB rather than their own row-per-point table because they
-- are only ever read and written whole, in order, as one thing.

CREATE TYPE map_shape_kind AS ENUM ('line', 'area');

CREATE TABLE map_shapes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id      UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    kind        map_shape_kind NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    points      JSONB NOT NULL,
    color       TEXT NOT NULL DEFAULT '#c96a5a',
    -- A road may be a dashed track; a border is dashed more often than not.
    dashed      BOOLEAN NOT NULL DEFAULT FALSE,
    -- Both normalised like the points, so they scale with the map: a stroke
    -- measured in pixels would be a hair on one map and a river on another.
    width       DOUBLE PRECISION NOT NULL DEFAULT 0.004,
    opacity     DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    dm_only     BOOLEAN NOT NULL DEFAULT FALSE,
    -- A zone can BE a place rather than merely name one (#233's world tree):
    -- tint Barovia, and clicking it opens Barovia. SET NULL, because losing
    -- the place should dim the link and never delete the drawing.
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_map_shapes_map ON map_shapes(map_id);

-- A pin is a pin no longer (#262). The default keeps every pin that exists
-- looking exactly as it does today.
ALTER TABLE map_pins ADD COLUMN shape TEXT NOT NULL DEFAULT 'pin';
