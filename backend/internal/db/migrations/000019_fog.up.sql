-- Fog of war. The DM stamps reveal circles onto a draft and submits them in
-- batches; players render everything outside their revealed area as black.
-- Scope is pool-based from day one: a batch belongs to a knowledge pool, and
-- a player sees the union of the pools they're in. Stage 1 ships a single
-- implicit party pool per campaign (is_party, no membership rows needed);
-- split parties, personal pools and merging arrive later with no rework.

ALTER TABLE maps ADD COLUMN fog_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE knowledge_pools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    -- The one pool every member of the campaign shares. Lazily created on
    -- first submit; at most one per campaign.
    is_party    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_pools_one_party
    ON knowledge_pools(campaign_id) WHERE is_party;

-- Explicit pool membership (unused by stage 1's party pool, which admits
-- every campaign member by definition).
CREATE TABLE knowledge_pool_members (
    pool_id UUID NOT NULL REFERENCES knowledge_pools(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (pool_id, user_id)
);

-- One submitted stamp session. Deleting a batch re-fogs its circles.
CREATE TABLE reveal_batches (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id     UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    pool_id    UUID NOT NULL REFERENCES knowledge_pools(id) ON DELETE CASCADE,
    note       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reveal_batches_map ON reveal_batches(map_id);

-- The stamped circles: fractional center, radius as a fraction of the image
-- WIDTH (y distances are aspect-corrected when testing containment).
CREATE TABLE reveal_circles (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES reveal_batches(id) ON DELETE CASCADE,
    x        DOUBLE PRECISION NOT NULL,
    y        DOUBLE PRECISION NOT NULL,
    r        DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_reveal_circles_batch ON reveal_circles(batch_id);
