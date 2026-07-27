-- Mobs. Adding five skeletons at once used to mean five unrelated combatants:
-- five initiative rolls, five turns, five rows to scroll past. A group ties
-- those rows together so the tracker treats them as ONE instance — one roll,
-- one turn — while each skeleton keeps its own HP, because a DM still needs to
-- know which one is down to 3.
--
-- NULL means "on its own", which is every combatant added one at a time. That
-- is deliberate: adding a skeleton five separate times still gives five
-- independent monsters, exactly as before.
ALTER TABLE encounter_combatants ADD COLUMN group_id UUID;

-- Members are read together constantly (initiative, turn, aggregate HP).
CREATE INDEX idx_combatants_group ON encounter_combatants(encounter_id, group_id);
