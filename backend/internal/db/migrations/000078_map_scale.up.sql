-- A map says how far things are (#357).
--
-- The scale is ground, like the map itself (#234): every table on a realm walks
-- the same miles. It is stored as what the full width of the image spans —
-- "this map is 120 miles across" — because a point is already a fraction of
-- the width (x) and of the height (y), and the stored width and height turn
-- both into one distance. Set by the DM by measuring two known points; NULL
-- is a map nobody has measured, which says no distance at all rather than a
-- wrong one.
ALTER TABLE maps
    ADD COLUMN scale_distance DOUBLE PRECISION
        CHECK (scale_distance IS NULL OR scale_distance > 0),
    ADD COLUMN scale_unit TEXT
        CHECK (scale_unit IN ('miles', 'km', 'feet')),
    ADD CONSTRAINT maps_scale_whole
        CHECK ((scale_distance IS NULL) = (scale_unit IS NULL));
