-- Table-born characters: quick-added straight onto a campaign roster. They
-- belong to the table — never listed in My Heroes, never seated elsewhere,
-- deletable from the roster. Account heroes are the opposite: the roster may
-- only unseat them; destroying one is the owner's act alone.
-- Existing rows stay false: ambiguity resolves toward protecting characters.

ALTER TABLE characters ADD COLUMN table_born BOOLEAN NOT NULL DEFAULT false;
