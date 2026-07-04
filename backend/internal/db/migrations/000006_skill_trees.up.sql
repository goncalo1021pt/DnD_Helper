-- Skill trees: story-gated progression webs, separate from D&D advancement.
-- Content is data — the DM designs trees, nodes (minor powers / keystones)
-- and the connecting web in-app; the engine never hardcodes powers.

CREATE TYPE node_rarity AS ENUM ('minor', 'keystone');

CREATE TABLE skill_trees (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id        UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    -- Keystone cost model is a dial, not code: 1 = gated only by the web
    -- (Option B), 2 = a keystone eats two picks (Option A).
    keystone_pick_cost INT  NOT NULL DEFAULT 1,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skill_trees_campaign ON skill_trees(campaign_id);

CREATE TABLE skill_nodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tree_id     UUID NOT NULL REFERENCES skill_trees(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tradeoff    TEXT,                            -- keystones: the baked-in price
    rarity      node_rarity NOT NULL DEFAULT 'minor',
    limb        TEXT NOT NULL DEFAULT '',        -- grouping label, e.g. ENTROPY
    is_entry    BOOLEAN NOT NULL DEFAULT false,  -- pickable with no prior picks
    pos_x       REAL,                            -- optional, for the visual pass
    pos_y       REAL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skill_nodes_tree ON skill_nodes(tree_id);

-- The web: undirected adjacency between nodes of the same tree.
CREATE TABLE skill_edges (
    tree_id UUID NOT NULL REFERENCES skill_trees(id) ON DELETE CASCADE,
    node_a  UUID NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
    node_b  UUID NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (tree_id, node_a, node_b)
);

-- The pact: one tree per character, enforced by the primary key.
CREATE TABLE character_trees (
    character_id  UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    tree_id       UUID NOT NULL REFERENCES skill_trees(id) ON DELETE CASCADE,
    picks_granted INT NOT NULL DEFAULT 0
);

-- Spent picks: which nodes a character has claimed.
CREATE TABLE character_nodes (
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    node_id      UUID NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
    picked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, node_id)
);
