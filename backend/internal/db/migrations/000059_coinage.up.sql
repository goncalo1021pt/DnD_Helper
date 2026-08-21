-- The coin a table counts in (#195).
--
-- #174 shipped gold only, on purpose, and said where this would slot in: the
-- free-text price and the whole-gp parser behind fixtures/rules/price-gold.json.
-- A DM can now name their own coin — glimmer, trade bars, faction scrip — and
-- the Bazaar prices and charges in it.
--
-- The ladder is read whole on every price, is never queried across, and is
-- edited whole, so it lives as JSONB on the campaign rather than as a table.
-- NULL means the standard D&D ladder, which is what every table has today.
--
-- The base unit is the ladder's SMALLEST coin, and a purse counts base units.
-- That is what lets a purse be broken back down into coins for the sheet and
-- the roster — a purse counting the largest coin has nothing to break down.
ALTER TABLE campaigns ADD COLUMN coinage JSONB;

-- Which inventory row is the purse, as a fact rather than a guess.
--
-- It was "the first content-less row named exactly Gold Pieces", a rule spelled
-- out in four places that had to agree (the till, the Buy button, the sheet and
-- the printed sheet). The moment a DM renames their coin that rule stops being
-- true, so the row says what it is.
ALTER TABLE character_items ADD COLUMN is_purse BOOLEAN NOT NULL DEFAULT FALSE;

-- Exactly the rows the old rule would have picked: content-less, named Gold
-- Pieces, and the FIRST such row per hero — a second one was never the purse.
UPDATE character_items ci SET is_purse = TRUE
WHERE ci.id IN (
    SELECT DISTINCT ON (character_id) id
    FROM character_items
    WHERE content_id IS NULL AND name = 'Gold Pieces'
    ORDER BY character_id, created_at, id
);

-- A purse now counts base units, and the standard ladder's base is copper.
-- Every purse that exists holds gold, so it is worth exactly a hundred times
-- its number in the unit it is about to be read in. Nothing changes hands: the
-- prices are the same text, and 120 gp buys what 12,000 cp buys.
--
-- The check constraint is qty >= 1, and multiplying keeps that true.
UPDATE character_items SET qty = qty * 100 WHERE is_purse;
