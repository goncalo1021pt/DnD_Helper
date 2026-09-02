-- Pre-made heroes a DM offers to a one-shot's pool (#180).
--
-- A pregen is one of the DM's own heroes, seated at a campaign and flagged with
-- the author who offered it. It is *available* while the author still holds it
-- (owner_user_id = pregen_by); a claim is an ownership change to the claiming
-- member, and the author is remembered so a release can hand it back. On
-- ON DELETE SET NULL the flag clears if the offering DM's account is removed —
-- a claimed hero simply becomes fully its new owner's.
ALTER TABLE characters
    ADD COLUMN pregen_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- The pool is read per campaign; the partial index keeps it off every row that
-- is not a pregen (nearly all of them).
CREATE INDEX idx_characters_pregen ON characters (campaign_id)
    WHERE pregen_by IS NOT NULL;
