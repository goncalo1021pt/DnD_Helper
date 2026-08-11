-- Multiclassing (#190): a hero is a list of classes, not one class.
--
-- characters.class_id does NOT become a cache of "the first row here". It
-- keeps a meaning the 2024 rules give it directly: the class you *started*
-- as, which is the only one you take full starting proficiencies from — every
-- class after it grants a reduced set (PHB 2024, p.44). So the two are not
-- redundant, and neither can drift into disagreeing with the other about
-- something they both claim.
--
-- characters.level stays the TOTAL character level, because that is what the
-- rules key proficiency bonus, XP and cantrip scaling off. The per-class
-- levels live here and must sum to it; the API layer holds that invariant,
-- since a CHECK cannot see across rows.
CREATE TABLE character_classes (
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    -- SET NULL is not available to a primary key, and a class that vanished
    -- underneath a hero should not silently delete their levels in it either.
    -- RESTRICT makes deleting still-played content an error the DM can see,
    -- which matches how the codex already refuses to strike content in use.
    class_id     UUID NOT NULL REFERENCES rules_content(id) ON DELETE RESTRICT,
    -- The subclass chosen for THIS class. A Rogue 5 / Wizard 3 has a roguish
    -- archetype and an arcane tradition, and they are not interchangeable.
    subclass_id  UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    level        SMALLINT NOT NULL CHECK (level >= 1 AND level <= 20),
    -- Order taken: 0 is the starting class. Display order, and the tiebreak
    -- for anything that has to pick one class and mean it.
    position     SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, class_id)
);

CREATE INDEX idx_character_classes_character ON character_classes(character_id, position);

-- Backfill: every forged hero is single-classed today, so each gets exactly
-- one row carrying everything they already had. Quick-add heroes have no
-- class_id — they are a name, a freeform class string and a level — and get
-- no row, which is what the read path expects of them.
INSERT INTO character_classes (character_id, class_id, subclass_id, level, position)
SELECT id, class_id, subclass_id, GREATEST(1, LEAST(20, level)), 0
FROM characters
WHERE class_id IS NOT NULL;
