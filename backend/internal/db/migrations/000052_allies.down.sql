ALTER TABLE encounter_combatants DROP COLUMN npc_id;
DROP INDEX IF EXISTS idx_npcs_traveling;
ALTER TABLE npcs DROP CONSTRAINT npcs_control_shape;
ALTER TABLE npcs
    DROP COLUMN traveling,
    DROP COLUMN hp_current,
    DROP COLUMN control,
    DROP COLUMN control_user_id;
