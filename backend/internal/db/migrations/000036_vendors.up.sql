-- Who sells what, and where (#102).
--
-- A shop is prep, like an encounter: the DM stocks it at home and the party
-- meets it at the table. So a vendor is filed under a place the same way an
-- encounter is, and the places tree built in #149 does the rest — a smith in
-- Phandalin turns up when the party is in Phandalin.
--
-- No money changes hands here. Buying is out loud at the table; this holds the
-- list the DM reads from, and what the party has been told about it.

CREATE TABLE vendors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- Deleting a place unfiles its shops rather than closing them, exactly as
    -- it unfiles encounters.
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    -- A shop the party has not met yet is the DM's alone. Revealed one at a
    -- time, deliberately, the way the bestiary hands over a creature's record.
    revealed    BOOLEAN NOT NULL DEFAULT false,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendors_campaign ON vendors(campaign_id);
CREATE INDEX idx_vendors_location ON vendors(location_id);

CREATE TABLE vendor_stock (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    -- The armory entry behind the line, when there is one. SET NULL keeps the
    -- line (and its price) alive if the item content is ever deleted, which is
    -- why the name is snapshotted beside it.
    content_id UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    -- Free text, and the same shape an item's own cost uses ("15 gp"), because
    -- a shop marks up: the price here is what THIS trader asks, not what the
    -- book says the thing is worth.
    price      TEXT NOT NULL DEFAULT '',
    -- NULL is "as many as you like" — a general store never runs out of rope.
    qty        INT,
    -- Stock is revealed line by line, so a DM can show the party the swords on
    -- the wall and keep what is under the counter.
    revealed   BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vendor_stock_qty_sane CHECK (qty IS NULL OR qty >= 0)
);
CREATE INDEX idx_vendor_stock_vendor ON vendor_stock(vendor_id);
