-- What a rest actually spends.
--
-- Long and short rests existed only as reference text (#118): nothing reset a
-- spell slot, restored a hit point, or spent a hit die. After a night at the
-- table a player un-clicked every spent slot by hand, clicked HP up to max, and
-- then separately tapped the spell swap — three chores for one action in the
-- rules.
--
-- Hit dice are the piece that was never modelled. A hero has one per level, so
-- the total is derived and only the SPENT count needs storing: a short rest
-- spends them to heal, a long rest hands half of them back. Stored as spent
-- rather than remaining so that levelling up grants a die for free — the total
-- moves with the level and the spent count stays where it was.

ALTER TABLE characters ADD COLUMN hit_dice_used SMALLINT NOT NULL DEFAULT 0;

-- A hero can never have spent more dice than they have levels. The rest rules
-- clamp this too, but the column is the thing every future writer has to get
-- past, not just today's handler.
ALTER TABLE characters ADD CONSTRAINT characters_hit_dice_used_sane
    CHECK (hit_dice_used >= 0);
