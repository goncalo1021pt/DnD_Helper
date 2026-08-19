-- Which party an ally rides with (#232, found in testing).
--
-- #228 gave a person a `traveling` flag and nothing to travel *with*, because
-- there was only ever one party. With the table split, "Sildar travels with
-- you" has to answer "with whom" — or he shows up on every roster at once,
-- which is what the table saw.
--
-- NULL means the whole table, the same thing it means for a fog batch: an ally
-- everybody shares. ON DELETE SET NULL, because disbanding a party must not
-- quietly strike the person riding with it — they simply walk with everyone
-- again, and the DM re-files them.
ALTER TABLE npcs
    ADD COLUMN party_id UUID REFERENCES parties(id) ON DELETE SET NULL;
CREATE INDEX idx_npcs_party ON npcs(party_id) WHERE traveling;
