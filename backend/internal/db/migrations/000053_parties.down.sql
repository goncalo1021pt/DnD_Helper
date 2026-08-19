CREATE TABLE knowledge_pools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    is_party    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_pools_one_party
    ON knowledge_pools(campaign_id) WHERE is_party;

CREATE TABLE knowledge_pool_members (
    pool_id UUID NOT NULL REFERENCES knowledge_pools(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (pool_id, user_id)
);

-- Every campaign gets its party pool back, and every batch points at its own.
-- The per-hero snapshot cannot be expressed as a user-keyed pool, so it is
-- lost on the way down — the fog itself is not.
INSERT INTO knowledge_pools (campaign_id, name, is_party)
SELECT id, 'The Party', true FROM campaigns;

ALTER TABLE reveal_batches
    ADD COLUMN pool_id UUID REFERENCES knowledge_pools(id) ON DELETE CASCADE;
UPDATE reveal_batches b
SET pool_id = p.id
FROM maps mp, knowledge_pools p
WHERE mp.id = b.map_id AND p.campaign_id = mp.campaign_id AND p.is_party;
DELETE FROM reveal_batches WHERE pool_id IS NULL;
ALTER TABLE reveal_batches ALTER COLUMN pool_id SET NOT NULL;

ALTER TABLE reveal_batches DROP COLUMN party_id;
DROP TABLE reveal_batch_heroes;
DROP INDEX IF EXISTS idx_characters_party;
ALTER TABLE characters DROP COLUMN party_id;
DROP TABLE parties;
