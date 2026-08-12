-- Hit dice, per die type (#190).
--
-- hit_dice_used was a single count, which is only ever right for a hero with
-- one class. The 2024 rules pool hit dice by die type and track the types
-- separately: a level 5 Cleric / level 5 Paladin has five d8 and five d10, and
-- spending a d10 on a short rest must not consume a d8 (PHB 2024, p.44).
--
-- Shaped like pools_used, deliberately: only what has been SPENT is stored,
-- keyed by die size, and the maximum is recomputed from the hero's class rows
-- on every read. A hero who takes another Fighter level has more d10s the
-- moment the level lands, with nothing to migrate.
ALTER TABLE characters ADD COLUMN hit_dice_spent JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: every hero is single-classed today, so whatever they had spent was
-- spent on their one class's die.
UPDATE characters c
SET hit_dice_spent = jsonb_build_object(COALESCE(rc.data->>'hitDie', '8'), c.hit_dice_used)
FROM rules_content rc
WHERE rc.id = c.class_id AND c.hit_dice_used > 0;

-- Quick-add heroes have no class and so no declared die. The short rest has
-- always rolled a d8 for them (see shortRest's fallback), so that is the die
-- they have been spending.
UPDATE characters
SET hit_dice_spent = jsonb_build_object('8', hit_dice_used)
WHERE class_id IS NULL AND hit_dice_used > 0;

ALTER TABLE characters DROP COLUMN hit_dice_used;
