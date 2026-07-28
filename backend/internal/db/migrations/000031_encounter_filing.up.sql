-- Filing for the encounter library. A campaign that runs long accumulates
-- dozens of prepared fights in one flat list, and "which one was the ambush in
-- Vallaki?" becomes a scroll. Two axes, because a fight belongs to both a night
-- at the table and a place on the map:
--
--   tag         free text — "Session 12", "Act II", "Chapter: The Ashen Road"
--   location_id the place tree the quests already hang off (#96)
--
-- Both are optional: an unfiled encounter still sits in the library, gathered
-- under "Unfiled" instead of vanishing. Deleting a place unfiles its encounters
-- rather than deleting them — the prepared fight outlives the map pin.

ALTER TABLE encounters
    ADD COLUMN tag         TEXT NOT NULL DEFAULT '',
    ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX idx_encounters_location ON encounters(location_id);
-- The library groups by tag within a campaign; this is the index that read hits.
CREATE INDEX idx_encounters_campaign_tag ON encounters(campaign_id, tag);
