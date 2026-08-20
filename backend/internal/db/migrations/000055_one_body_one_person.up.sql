-- One body, one person (#267).
--
-- A body is the sheet forged for one of the Folk: nothing else ever points at
-- it, which is why parting with it strikes it (#227). But `resolveNpcStats`
-- only ever asked whether a character was a body OF THIS CAMPAIGN, so two
-- people could be pointed at the same one. Two things break when they are:
-- "read a body through its person" has no single answer, and `strikeNpcBody`
-- destroys a sheet the other person is still standing behind.
--
-- The invariant belongs to the schema rather than to the handler that happens
-- to write it, so the handler's refusal is a courtesy and this is the truth.

-- Any pair that already exists — an NPC could be attached to a seated hero
-- under the pre-#227 rules, and migration 51 turned every such hero into a
-- body, so a hero two people shared came out the other side as a shared body.
-- The earliest person keeps them; the rest let go. Degrade rather than delete,
-- the way losing a place or a monster degrades a person.
UPDATE npcs SET character_id = NULL
WHERE character_id IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (character_id) id
    FROM npcs
    WHERE character_id IS NOT NULL
    ORDER BY character_id, created_at, id
  );

CREATE UNIQUE INDEX idx_npcs_character_id ON npcs(character_id)
WHERE character_id IS NOT NULL;
