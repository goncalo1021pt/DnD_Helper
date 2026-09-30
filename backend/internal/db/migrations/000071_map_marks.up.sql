-- A player's own marks on a map (#356).
--
-- A mark rides the same rows a DM's pin and road do, told apart by having an
-- author. It is knowledge, not ground (#234): it belongs to one table, so it
-- carries the campaign it was made at, and a sibling campaign on the same realm
-- never receives it. A DM's pin and shape keep both columns NULL and stay ground.
--
-- Served only to its author and the table's DMs, unless `shared` puts it in
-- front of the whole table. It names no place, sits in no DM layer, and is
-- never dm_only — the handlers hold those; the schema holds the one rule that
-- would otherwise need remembering in every door that ends a seat: the pair
-- references the membership, so leaving, being removed or barred, and striking
-- the campaign all take a player's marks with their seat.
ALTER TABLE map_pins
    ADD COLUMN author_user_id UUID,
    ADD COLUMN campaign_id    UUID,
    ADD COLUMN shared         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT map_pins_mark_seat FOREIGN KEY (author_user_id, campaign_id)
        REFERENCES memberships(user_id, campaign_id) ON DELETE CASCADE,
    ADD CONSTRAINT map_pins_mark_whole CHECK ((author_user_id IS NULL) = (campaign_id IS NULL));

ALTER TABLE map_shapes
    ADD COLUMN author_user_id UUID,
    ADD COLUMN campaign_id    UUID,
    ADD COLUMN shared         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT map_shapes_mark_seat FOREIGN KEY (author_user_id, campaign_id)
        REFERENCES memberships(user_id, campaign_id) ON DELETE CASCADE,
    ADD CONSTRAINT map_shapes_mark_whole CHECK ((author_user_id IS NULL) = (campaign_id IS NULL));

CREATE INDEX idx_map_pins_mark_seat ON map_pins(author_user_id, campaign_id) WHERE author_user_id IS NOT NULL;
CREATE INDEX idx_map_shapes_mark_seat ON map_shapes(author_user_id, campaign_id) WHERE author_user_id IS NOT NULL;
