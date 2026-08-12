-- A pure Warlock's spent pact slots go back into the shared array at their
-- pact level, which is where they lived before. A multiclassed one's cannot
-- be expressed at all going back, and are dropped.
UPDATE characters c
SET spell_slots_used = (
        SELECT array_agg(CASE WHEN i = 1 THEN c.pact_slots_used ELSE 0 END ORDER BY i)::smallint[]
        FROM generate_series(1, 9) AS i
    )
FROM rules_content rc
WHERE rc.id = c.class_id AND rc.data->>'spellcaster' = 'pact' AND c.pact_slots_used > 0;

ALTER TABLE characters DROP COLUMN pact_slots_used;

DROP INDEX IF EXISTS idx_character_spells_class;
ALTER TABLE character_spells DROP COLUMN class_id;
