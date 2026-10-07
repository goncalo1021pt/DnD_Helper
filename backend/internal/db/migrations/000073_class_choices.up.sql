-- What a hero answered when a class feature asked them to choose (#382): a
-- Fighter's Fighting Style, a Rogue's Expertise, a Cleric's Divine Order. Keyed
-- by the content that asked and the choice's own id ("<content id>:<choice
-- id>"), each holding the chosen names. Nothing is backfilled — a choice a hero
-- is owed and never made is what the sheet asks them for.
ALTER TABLE characters ADD COLUMN class_choices JSONB NOT NULL DEFAULT '{}'::jsonb;
