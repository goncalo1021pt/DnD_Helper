ALTER TABLE character_items
    DROP CONSTRAINT character_items_data_only_written_in,
    DROP COLUMN custom_name,
    DROP COLUMN notes,
    DROP COLUMN data;
