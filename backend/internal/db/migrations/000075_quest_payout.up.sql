-- A quest's rewards become goods a payout can hand over (#395).
-- An item reward may name an armory entry and a quantity; a quest records that
-- it paid, so re-opening and re-completing it never pays twice.
ALTER TABLE quest_rewards
    ADD COLUMN item_id UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    ADD COLUMN qty     INTEGER NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 999);

ALTER TABLE quests ADD COLUMN paid_at TIMESTAMPTZ;
