-- Best-effort reversal. Each place and map gets ONE campaign back — read from
-- its state row, else any campaign on its realm. A realm that gained a second
-- campaign after the move is not losslessly reversible (one place, two
-- candidate owners); ground on a realm with no campaign at all had no owner
-- under the old model and is dropped, as it would have died with the table.

ALTER TABLE locations ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE locations ADD COLUMN visible_to_party BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE locations l SET campaign_id = s.campaign_id, visible_to_party = s.visible_to_party
FROM (
    SELECT DISTINCT ON (location_id) location_id, campaign_id, visible_to_party
    FROM location_campaign_state ORDER BY location_id, updated_at DESC
) s WHERE s.location_id = l.id;
UPDATE locations l SET campaign_id = c.id
FROM (SELECT DISTINCT ON (realm_id) realm_id, id FROM campaigns ORDER BY realm_id, created_at) c
WHERE l.campaign_id IS NULL AND c.realm_id = l.realm_id;
DELETE FROM locations WHERE campaign_id IS NULL;
ALTER TABLE locations ALTER COLUMN campaign_id SET NOT NULL;
CREATE INDEX idx_locations_campaign ON locations(campaign_id);

ALTER TABLE maps ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE maps ADD COLUMN visible_to_party BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE maps m SET campaign_id = s.campaign_id, visible_to_party = s.visible_to_party
FROM (
    SELECT DISTINCT ON (map_id) map_id, campaign_id, visible_to_party
    FROM map_campaign_state ORDER BY map_id, updated_at DESC
) s WHERE s.map_id = m.id;
UPDATE maps m SET campaign_id = c.id
FROM (SELECT DISTINCT ON (realm_id) realm_id, id FROM campaigns ORDER BY realm_id, created_at) c
WHERE m.campaign_id IS NULL AND c.realm_id = m.realm_id;
DELETE FROM maps WHERE campaign_id IS NULL;
ALTER TABLE maps ALTER COLUMN campaign_id SET NOT NULL;
CREATE INDEX idx_maps_campaign ON maps(campaign_id);

DROP INDEX IF EXISTS idx_reveal_batches_map_campaign;
ALTER TABLE reveal_batches DROP COLUMN campaign_id;

DROP TABLE map_campaign_state;
DROP TABLE location_campaign_state;
DROP INDEX IF EXISTS idx_maps_realm;
ALTER TABLE maps DROP COLUMN realm_id;
DROP INDEX IF EXISTS idx_locations_realm;
ALTER TABLE locations DROP COLUMN realm_id;
