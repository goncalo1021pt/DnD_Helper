ALTER TABLE characters
    DROP COLUMN IF EXISTS strength,
    DROP COLUMN IF EXISTS dexterity,
    DROP COLUMN IF EXISTS constitution,
    DROP COLUMN IF EXISTS intelligence,
    DROP COLUMN IF EXISTS wisdom,
    DROP COLUMN IF EXISTS charisma,
    DROP COLUMN IF EXISTS skills,
    DROP COLUMN IF EXISTS class_id,
    DROP COLUMN IF EXISTS species_id,
    DROP COLUMN IF EXISTS background_id;
