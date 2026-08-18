-- A sheet makes a person statted; it never makes them a party member (#227).
--
-- Attaching a sheet to an NPC (#215/#222) used to demand a character already
-- seated at the campaign, so the only way to stat the tavern keeper was to
-- quick-add them onto the Party page first. They then sat in the roster with an
-- HP bar, were counted among the adventurers, and — because every campaign
-- character owned by a user reads as one of that user's heroes — resolved veils
-- as if they were the DM's own hero.
--
-- `kind` is the discriminator that ends the guessing. The party query becomes
-- `WHERE kind = 'hero'`, and the roster, the count, the Hall block, the
-- chronicle, encounter seating and the veil resolver all filter for free.
--
-- `table_born` goes back to meaning one thing: a stub for a guest at the table
-- who has no account. It stops doubling as "body of an NPC".

CREATE TYPE character_kind AS ENUM ('hero', 'npc');

ALTER TABLE characters ADD COLUMN kind character_kind NOT NULL DEFAULT 'hero';

-- Every sheet a person already stands behind is a body, not a hero. These rows
-- are exactly the ones polluting rosters today, and `table_born` lets go of
-- them with the same stroke so it means one thing again rather than two.
UPDATE characters SET kind = 'npc', table_born = false
WHERE id IN (SELECT character_id FROM npcs WHERE character_id IS NOT NULL);

CREATE INDEX idx_characters_campaign_kind ON characters(campaign_id, kind);
