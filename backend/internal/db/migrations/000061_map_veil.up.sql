-- A map that exists is a spoiler (#276).
--
-- Until now every member of a campaign received every map in it: the atlas
-- listed the name of the dungeon the party had not found, and the picture
-- opened for anyone holding the id. Fog covered the ground and left the map
-- itself announcing that there was ground to cover.
--
-- So a map carries the veil everything else in the campaign carries: a
-- party-wide flag with per-hero exceptions over it, resolved through the
-- viewer's own heroes. The same two layers as places, notices, the Folk and
-- the handouts, which is why the DM's control is the very same one.
--
-- The default is false and the backfill is true, deliberately and in that
-- order. Every map that already hangs in a hall keeps hanging there — nothing
-- a table can see today disappears at deploy — while the NEXT map a DM hangs
-- is theirs until they say otherwise, because a lair map is uploaded before
-- the session it is found in.
ALTER TABLE maps ADD COLUMN visible_to_party BOOLEAN NOT NULL DEFAULT false;
UPDATE maps SET visible_to_party = true;

-- Per-hero exceptions, same shape as location_visibility / npc_visibility.
CREATE TABLE map_visibility (
    map_id       UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    visible      BOOLEAN NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (map_id, character_id)
);

CREATE INDEX idx_map_visibility_character ON map_visibility(character_id);
