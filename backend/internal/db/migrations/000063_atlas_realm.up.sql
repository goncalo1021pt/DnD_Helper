-- The atlas moves up (#234): locations and maps become the realm's ground,
-- and what each table KNOWS of them stays with the campaign.
--
-- Ground truth — a place's name and parent, a map's image and where it hangs,
-- pins and shapes — is authored once for the realm, so every campaign standing
-- on it walks the same ground. Knowledge — whether THIS table has found a
-- place or a map, and the fog THIS table has lifted — is per campaign, and
-- moves into small state tables keyed by (thing, campaign).
--
-- Order matters once, at step 5: reveal batches learn their campaign from
-- maps.campaign_id, so that column must still be there when they do. The
-- backfill is one-to-one because stage one (#233) gave every campaign a realm
-- of its own.

-- 1. locations stand on a realm.
ALTER TABLE locations ADD COLUMN realm_id UUID REFERENCES realms(id) ON DELETE CASCADE;
UPDATE locations l SET realm_id = c.realm_id FROM campaigns c WHERE c.id = l.campaign_id;
ALTER TABLE locations ALTER COLUMN realm_id SET NOT NULL;
CREATE INDEX idx_locations_realm ON locations(realm_id);

-- 2. Whether a table has found a place. No row = veiled: a campaign founded on
--    old ground starts dark and its DM reveals as the party finds things.
CREATE TABLE location_campaign_state (
    location_id      UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    visible_to_party BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (location_id, campaign_id)
);
CREATE INDEX idx_location_campaign_state_campaign ON location_campaign_state(campaign_id);
INSERT INTO location_campaign_state (location_id, campaign_id, visible_to_party)
SELECT id, campaign_id, visible_to_party FROM locations;

-- 3. maps hang on a realm.
ALTER TABLE maps ADD COLUMN realm_id UUID REFERENCES realms(id) ON DELETE CASCADE;
UPDATE maps m SET realm_id = c.realm_id FROM campaigns c WHERE c.id = m.campaign_id;
ALTER TABLE maps ALTER COLUMN realm_id SET NOT NULL;
CREATE INDEX idx_maps_realm ON maps(realm_id);

-- 4. Whether a table has found a map (#276's veil, per campaign).
CREATE TABLE map_campaign_state (
    map_id           UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    visible_to_party BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (map_id, campaign_id)
);
CREATE INDEX idx_map_campaign_state_campaign ON map_campaign_state(campaign_id);
INSERT INTO map_campaign_state (map_id, campaign_id, visible_to_party)
SELECT id, campaign_id, visible_to_party FROM maps;

-- 5. Fog is one table's session history: a batch carries its campaign. Read
--    off the map's campaign BEFORE that column goes in step 6.
ALTER TABLE reveal_batches ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE;
UPDATE reveal_batches b SET campaign_id = m.campaign_id FROM maps m WHERE m.id = b.map_id;
ALTER TABLE reveal_batches ALTER COLUMN campaign_id SET NOT NULL;
CREATE INDEX idx_reveal_batches_map_campaign ON reveal_batches(map_id, campaign_id);

-- 6. The campaign no longer owns the ground, and knowledge no longer lives on
--    the ground row. From here ground dies with its realm (which cannot be
--    struck while a campaign stands on it) and a table's state dies with the
--    table — so a NAMED realm keeps its atlas after its last campaign leaves.
DROP INDEX IF EXISTS idx_locations_campaign;
ALTER TABLE locations DROP COLUMN campaign_id;
ALTER TABLE locations DROP COLUMN visible_to_party;
DROP INDEX IF EXISTS idx_maps_campaign;
ALTER TABLE maps DROP COLUMN campaign_id;
ALTER TABLE maps DROP COLUMN visible_to_party;
