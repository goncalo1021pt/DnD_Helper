ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_hit_dice_used_sane;

ALTER TABLE characters DROP COLUMN IF EXISTS hit_dice_used;
