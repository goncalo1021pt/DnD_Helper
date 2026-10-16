-- Starting gear is the DM's to hand out (#390). A table keeps its own packs
-- beside the two the books give each class: a name, the goods, and coin in the
-- table's own money. The items are stored as the gift door takes them
-- ({contentId?, name, qty}) with the NAME always kept, so a library entry
-- that is later struck degrades to a written-in row instead of vanishing.
CREATE TABLE campaign_packs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    items       JSONB NOT NULL DEFAULT '[]'::jsonb,
    coin        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaign_packs_campaign ON campaign_packs(campaign_id, name);

-- When a hero was last handed a starting pack, so the dialog can say so. NULL
-- is never; the DM may give a second one regardless, with a warning.
ALTER TABLE characters ADD COLUMN starting_pack_at TIMESTAMPTZ;
