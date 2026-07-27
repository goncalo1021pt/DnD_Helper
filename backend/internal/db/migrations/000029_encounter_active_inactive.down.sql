DROP INDEX IF EXISTS idx_combatants_character;
DROP INDEX IF EXISTS idx_encounters_active;

ALTER TABLE encounters DROP CONSTRAINT IF EXISTS encounters_status_check;
ALTER TABLE encounters ALTER COLUMN status SET DEFAULT 'draft';

UPDATE encounters SET status = 'draft' WHERE status = 'inactive';

-- The old schema allowed exactly one active encounter per campaign, so
-- everything but the newest running one has to stand down before the unique
-- index can come back.
UPDATE encounters e SET status = 'ended'
WHERE e.status = 'active' AND e.id <> (
    SELECT x.id FROM encounters x
    WHERE x.campaign_id = e.campaign_id AND x.status = 'active'
    ORDER BY x.created_at DESC, x.id
    LIMIT 1
);

CREATE UNIQUE INDEX idx_encounters_one_active
    ON encounters(campaign_id) WHERE status = 'active';
