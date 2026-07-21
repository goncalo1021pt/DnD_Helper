-- Encounters: the DM's combat tool. Encounters are prepared ahead of time as
-- drafts (a per-campaign library), triggered at will, and run through an
-- initiative tracker. At most one is active per campaign at a time.
CREATE TABLE encounters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft',  -- draft | active | ended
    round       INT NOT NULL DEFAULT 1,
    turn_index  INT NOT NULL DEFAULT 0,         -- index into the initiative order
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_encounters_campaign ON encounters(campaign_id, created_at DESC);
-- At most one active encounter per campaign.
CREATE UNIQUE INDEX idx_encounters_one_active
    ON encounters(campaign_id) WHERE status = 'active';

-- Combatants are a SNAPSHOT: a monster from the Den, a seated PC, or a typed
-- custom line (an NPC, a hazard). Stats are copied in at add-time so editing
-- the source later never mutates a prepared encounter. Players never receive
-- hidden combatants, and see revealed ones by player_label with HP only as a
-- state — the DM controls the reveal.
CREATE TABLE encounter_combatants (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,                 -- monster | pc | custom
    content_id   UUID REFERENCES rules_content(id) ON DELETE SET NULL,  -- the Den monster
    character_id UUID REFERENCES characters(id) ON DELETE SET NULL,     -- the seated PC
    label        TEXT NOT NULL,                 -- the DM's name for it (true name)
    player_label TEXT NOT NULL DEFAULT '',      -- what players see (blank ⇒ "Unknown")
    init_mod     INT NOT NULL DEFAULT 0,        -- initiative modifier (DEX-based)
    initiative   INT,                           -- rolled/typed order value; NULL until set
    hp_current   INT NOT NULL DEFAULT 0,
    hp_max       INT NOT NULL DEFAULT 0,
    ac           INT NOT NULL DEFAULT 10,
    hidden       BOOLEAN NOT NULL DEFAULT false, -- true ⇒ players don't see it at all
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_combatants_encounter ON encounter_combatants(encounter_id);
