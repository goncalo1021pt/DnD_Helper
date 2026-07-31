-- Same key, same hero.
--
-- A forge that times out has not necessarily failed: the request may have
-- landed and built the hero while the answer was lost on the way back. Before
-- this, the retry that followed built a second one, and the player arrived at
-- the table with twins (#130).
--
-- The key the client sent with the attempt is remembered on the hero it made,
-- so a repeat of that same attempt finds the hero instead of forging another.
-- Nullable because every hero created any other way — the plain roster form,
-- the seed, everything before today — has no key and never will; NULLs are
-- distinct in a UNIQUE index, so they do not collide with each other.

ALTER TABLE characters ADD COLUMN forge_key UUID;

CREATE UNIQUE INDEX idx_characters_forge_key
    ON characters(owner_user_id, forge_key)
    WHERE forge_key IS NOT NULL;
