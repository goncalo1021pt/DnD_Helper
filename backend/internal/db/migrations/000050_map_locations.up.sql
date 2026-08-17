-- A map may depict a place (#229): the world map of the realm, the city map
-- of Ars, a tavern battle map inside it. The place tree stays the single
-- spine — a map BELONGS TO a place, optionally, and survives losing it
-- (SET NULL): the image is the DM's work either way. Contrast reveal_batches
-- (000048), which CASCADE — a batch that lost its place would leak ground.
ALTER TABLE maps
    ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
