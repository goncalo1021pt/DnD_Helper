-- A forged hero remembers which submission made it.
--
-- #130: on a slow link the Forge POST can time out after the server has already
-- built the hero. The player, seeing nothing, submits again. Without a key that
-- second attempt forges a second hero from twenty minutes of choices they only
-- made once. With one, the server recognises the repeat and hands back the hero
-- it already made.
--
-- Nullable, because every other route into `characters` (quick-add, table-born)
-- has no wizard behind it and nothing to be idempotent about. The unique index
-- is therefore partial, and scoped to the owner so two players cannot collide.
ALTER TABLE characters ADD COLUMN forge_key TEXT;

CREATE UNIQUE INDEX idx_characters_forge_key
    ON characters (owner_user_id, forge_key)
    WHERE forge_key IS NOT NULL;
