-- Parties: named groups of heroes, and the end of the fog-only pool (#232).
--
-- The real table this is for has 10–12 players and more than one session group
-- adventuring on different objectives in one world. That is the West Marches
-- shape, and its governing rule is that KNOWLEDGE BELONGS TO THE HEROES WHO
-- WERE THERE — not to a group, which is a thing that changes.
--
-- So a party is a brush, not a gate. Revealing a notice "to the Harbour Crew"
-- stamps the very same per-hero rows the DM could have clicked one at a time,
-- and every resolver in the app keeps working untouched. Moving a hero to
-- another party takes nothing away from them, and striking a party takes
-- nothing away from anybody — because nothing was ever hung on the party
-- itself.
--
-- `knowledge_pools` was the same idea, built for fog alone and keyed by USER —
-- the one veil in the app that did not resolve through heroes. Its member
-- table was never written to: only the single `is_party` pool was ever
-- created. It goes, and fog joins everything else.

CREATE TABLE parties (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_parties_campaign ON parties(campaign_id, created_at);

-- A hero rides with one party at a time, or with none yet. ON DELETE SET NULL
-- because striking a party disbands it; it never strikes the heroes in it.
ALTER TABLE characters
    ADD COLUMN party_id UUID REFERENCES parties(id) ON DELETE SET NULL;
CREATE INDEX idx_characters_party ON characters(party_id);

-- Fog remembers who was there, rather than which group it was stamped for.
--
-- A batch holds circles, not per-hero rows, so it cannot be brushed the way
-- the other five veils are — it needs somewhere to record the heroes standing
-- in the party at the moment the DM submitted. No rows means the whole table,
-- exactly as an empty override list means the whole table everywhere else.
CREATE TABLE reveal_batch_heroes (
    batch_id     UUID NOT NULL REFERENCES reveal_batches(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    PRIMARY KEY (batch_id, character_id)
);
CREATE INDEX idx_reveal_batch_heroes_character ON reveal_batch_heroes(character_id);

-- The party a batch was stamped for, kept as PROVENANCE and nothing else: the
-- DM's ledger says "the Harbour Crew, session 12" rather than "four heroes",
-- while `reveal_batch_heroes` above stays the only thing that gates anything.
-- Disbanding the party blanks the label and changes what nobody can see.
ALTER TABLE reveal_batches
    ADD COLUMN party_id UUID REFERENCES parties(id) ON DELETE SET NULL;

-- Carry the old pools over. Everything stamped for the campaign-wide pool is
-- table-wide and needs no rows at all; anything stamped for a named pool
-- becomes a snapshot of its members' heroes at this table.
INSERT INTO reveal_batch_heroes (batch_id, character_id)
SELECT b.id, ch.id
FROM reveal_batches b
JOIN knowledge_pools p ON p.id = b.pool_id AND NOT p.is_party
JOIN knowledge_pool_members m ON m.pool_id = p.id
JOIN maps mp ON mp.id = b.map_id
JOIN characters ch
  ON ch.owner_user_id = m.user_id
 AND ch.campaign_id = mp.campaign_id
 AND ch.kind = 'hero'
ON CONFLICT DO NOTHING;

ALTER TABLE reveal_batches DROP COLUMN pool_id;
DROP TABLE knowledge_pool_members;
DROP TABLE knowledge_pools;
