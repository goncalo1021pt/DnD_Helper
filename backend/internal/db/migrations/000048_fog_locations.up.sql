-- Fog tied to a place (#191). A reveal batch may name a location; when it
-- does, its circles lift only for a hero the place's veil already admits.
--
-- That is what makes "she grew up in Lisboa" expressible: the DM stamps the
-- city once, ties the batch to Lisboa, and reveals Lisboa to that one hero.
-- Nobody else's fog moves. When the party finally rides in, flipping Lisboa
-- to party-visible lifts the same ground for everyone — the reveal is not
-- re-stamped, it was always there waiting on the veil.
--
-- A batch with no location is the old behaviour, untouched: the pool alone
-- decides, so every batch stamped before this migration still reads as one
-- the whole party has.
ALTER TABLE reveal_batches
    ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE CASCADE;

-- CASCADE, not SET NULL: a batch that lost its place would fall back to the
-- pool rule, which means deleting a city would hand its ground to the whole
-- table. Losing the DM's stamps is recoverable; leaking the map is not.
CREATE INDEX idx_reveal_batches_location ON reveal_batches(location_id);
