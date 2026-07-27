-- Fold the tree back into the freeform text column before dropping it, so a
-- rollback keeps the place each notice named.
UPDATE quests q
SET location = l.name
FROM locations l
WHERE l.id = q.location_id;

DROP TABLE IF EXISTS quest_visibility;
DROP TABLE IF EXISTS location_visibility;

DROP INDEX IF EXISTS idx_quests_location;

ALTER TABLE quests
    DROP COLUMN IF EXISTS location_id,
    DROP COLUMN IF EXISTS visible_to_party;

DROP TABLE IF EXISTS locations;
