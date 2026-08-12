-- Collapsing back to one count loses which die a multiclassed hero had spent;
-- the total survives, which is what the old column could express.
ALTER TABLE characters ADD COLUMN hit_dice_used SMALLINT NOT NULL DEFAULT 0;

UPDATE characters c
SET hit_dice_used = LEAST(32767, GREATEST(0, (
    SELECT COALESCE(SUM((value)::int), 0)
    FROM jsonb_each_text(c.hit_dice_spent)
)));

ALTER TABLE characters DROP COLUMN hit_dice_spent;
