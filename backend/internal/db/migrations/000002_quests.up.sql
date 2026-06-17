-- Quest board: quests, their rewards, and player claims.

CREATE TYPE quest_status AS ENUM ('available', 'active', 'completed', 'failed');
CREATE TYPE quest_difficulty AS ENUM ('trivial', 'easy', 'medium', 'hard', 'deadly');
CREATE TYPE reward_type AS ENUM ('gold', 'item', 'xp', 'reputation', 'other');

CREATE TABLE quests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    giver       TEXT,                       -- NPC who offers the quest
    location    TEXT,
    difficulty  quest_difficulty NOT NULL DEFAULT 'medium',
    status      quest_status NOT NULL DEFAULT 'available',
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quests_campaign ON quests(campaign_id);

CREATE TABLE quest_rewards (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    type     reward_type NOT NULL,
    label    TEXT NOT NULL,
    value    TEXT                            -- freeform: "500", "Flametongue", etc.
);

CREATE INDEX idx_quest_rewards_quest ON quest_rewards(quest_id);

-- A quest can be claimed by multiple players (the party takes it together).
CREATE TABLE quest_claims (
    quest_id   UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (quest_id, user_id)
);
