-- Party roster: lightweight player characters per campaign. The full character
-- builder comes later; this stores what the roster shows (name, class, level, HP).

CREATE TABLE characters (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    class         TEXT NOT NULL DEFAULT '',  -- freeform: "Half-Elf Bard"
    level         INT  NOT NULL DEFAULT 1,
    hp_current    INT  NOT NULL DEFAULT 10,
    hp_max        INT  NOT NULL DEFAULT 10,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_characters_campaign ON characters(campaign_id);
