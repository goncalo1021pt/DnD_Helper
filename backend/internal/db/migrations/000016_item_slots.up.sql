-- Real equipment slots: where an equipped item sits. '' = unequipped,
-- 'armor' = worn, 'mainhand'/'offhand' = held (off-hand fits a shield or a
-- second weapon). Numbered 16 alongside the monster branch's 15 so the two
-- lines rebase cleanly without colliding.
ALTER TABLE character_items ADD COLUMN slot TEXT NOT NULL DEFAULT '';

-- Backfill from the old single equipped flag, typed via the linked content.
UPDATE character_items ci SET slot = 'armor'
FROM rules_content rc
WHERE ci.content_id = rc.id AND ci.equipped AND rc.data->>'type' = 'armor';

UPDATE character_items ci SET slot = 'offhand'
FROM rules_content rc
WHERE ci.content_id = rc.id AND ci.equipped AND rc.data->>'type' = 'shield';

WITH w AS (
    SELECT ci.id, row_number() OVER (PARTITION BY ci.character_id ORDER BY ci.id) AS rn
    FROM character_items ci
    JOIN rules_content rc ON rc.id = ci.content_id
    WHERE ci.equipped AND rc.data->>'type' = 'weapon'
)
UPDATE character_items ci
SET slot = CASE WHEN w.rn = 1 THEN 'mainhand' WHEN w.rn = 2 THEN 'offhand' ELSE '' END
FROM w WHERE ci.id = w.id;

-- A shield and a second weapon can't both have been sensible; if the backfill
-- double-booked the off-hand, the shield keeps it.
WITH dup AS (
    SELECT ci.id, row_number() OVER (
        PARTITION BY ci.character_id
        ORDER BY (rc.data->>'type' = 'shield') DESC, ci.id
    ) AS rn
    FROM character_items ci
    JOIN rules_content rc ON rc.id = ci.content_id
    WHERE ci.slot = 'offhand'
)
UPDATE character_items ci SET slot = '' FROM dup WHERE ci.id = dup.id AND dup.rn > 1;

-- The flag and the slot now agree.
UPDATE character_items SET equipped = false WHERE equipped AND slot = '';
