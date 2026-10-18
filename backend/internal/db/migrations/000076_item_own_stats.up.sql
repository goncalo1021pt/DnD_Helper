-- A row in a hero's pack may carry its own stats and its own words (#396).
--   data        the item fields the Archives form already has, on a written-in
--               row only: there it IS the item. A row linked to the armory takes
--               its numbers from that entry, as it always did.
--   notes       a line of the owner's own ("engraved with the family crest").
--   custom_name what this hero calls it; the armory's name still shows when it
--               is null, and follows the entry if the entry is renamed.
ALTER TABLE character_items
    ADD COLUMN data        JSONB,
    ADD COLUMN notes       TEXT NOT NULL DEFAULT '',
    ADD COLUMN custom_name TEXT,
    ADD CONSTRAINT character_items_data_only_written_in CHECK (data IS NULL OR content_id IS NULL);
