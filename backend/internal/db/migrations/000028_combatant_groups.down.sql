DROP INDEX IF EXISTS idx_combatants_group;
ALTER TABLE encounter_combatants DROP COLUMN IF EXISTS group_id;
