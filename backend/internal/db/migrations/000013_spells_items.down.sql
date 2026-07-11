-- Enum values stay (harmless when unused; removal needs a type rebuild).
DROP TABLE IF EXISTS character_items;
DROP TABLE IF EXISTS character_spells;
ALTER TABLE characters DROP COLUMN IF EXISTS spell_slots_used;
