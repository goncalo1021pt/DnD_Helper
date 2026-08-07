-- Resource pools: Rages, Channel Divinity, Focus Points (#175).
--
-- The pools a hero HAS are content, not rows: class, subclass, feat, species
-- and item entries declare them under data.pools, the way data.companions and
-- data.forms declare second stat blocks. What the database keeps is only what
-- the hero has SPENT, keyed by pool name — the maximum is recomputed from the
-- granting content and the hero's level on every read, so a level-up moves the
-- ceiling and the spent count stays where it was. Same rule as spell slots
-- (000013) and hit dice (000035).
ALTER TABLE characters ADD COLUMN pools_used JSONB NOT NULL DEFAULT '{}'::jsonb;
