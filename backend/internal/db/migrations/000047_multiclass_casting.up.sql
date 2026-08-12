-- Multiclass casting (#190, part 3).
--
-- Two facts the single-class model could leave implicit and this one cannot.

-- 1. Which class a prepared spell belongs to.
--
--    "You determine what spells you can prepare for each class individually,
--    as if you were a single-classed member of that class … Each spell you
--    prepare is associated with one of your classes, and you use the
--    spellcasting ability of that class when you cast the spell."
--    (PHB 2024, p.44)
--
--    A Ranger 4 / Sorcerer 3 prepares five Ranger spells and six Sorcerer
--    spells, and casts each off a different ability. One undifferentiated
--    list cannot say that. NULL means "from before this mattered" and reads
--    as the hero's starting class.
ALTER TABLE character_spells
    ADD COLUMN class_id UUID REFERENCES rules_content(id) ON DELETE SET NULL;

UPDATE character_spells cs
SET class_id = c.class_id
FROM characters c
WHERE c.id = cs.character_id AND c.class_id IS NOT NULL;

CREATE INDEX idx_character_spells_class ON character_spells(character_id, class_id);

-- 2. Pact Magic is its own pool.
--
--    Warlock levels are absent from the Multiclass Spellcaster table; their
--    slots sit beside it, refresh on a short rest, and can cast the other
--    classes' prepared spells (and be cast into by them). Sharing the
--    spell_slots_used array would make a spent pact slot eat a Wizard's.
--
--    A pure Warlock's slots have always ridden in that array, so what they
--    have spent moves across: their pact level is the only level they have.
ALTER TABLE characters ADD COLUMN pact_slots_used SMALLINT NOT NULL DEFAULT 0;

UPDATE characters c
SET pact_slots_used = LEAST(32767, GREATEST(0, (
        SELECT COALESCE(SUM(u), 0)
        FROM unnest(c.spell_slots_used) AS u
    ))),
    spell_slots_used = ARRAY[0,0,0,0,0,0,0,0,0]::smallint[]
FROM rules_content rc
WHERE rc.id = c.class_id AND rc.data->>'spellcaster' = 'pact';
