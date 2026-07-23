-- The DM's ceiling on hero levels at this table; NULL means the standard 20.

ALTER TABLE campaigns ADD COLUMN max_level SMALLINT;
