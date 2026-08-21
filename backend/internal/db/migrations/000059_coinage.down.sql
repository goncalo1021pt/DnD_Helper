UPDATE character_items SET qty = GREATEST(qty / 100, 1) WHERE is_purse;
ALTER TABLE character_items DROP COLUMN IF EXISTS is_purse;
ALTER TABLE campaigns DROP COLUMN IF EXISTS coinage;
