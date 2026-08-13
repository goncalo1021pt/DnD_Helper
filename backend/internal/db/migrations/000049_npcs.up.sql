-- NPCs: the people of a campaign (#215). An NPC is a name the party can meet —
-- a tavern keeper, a rival, a patron — filed under a place the way a shop or an
-- encounter is, and veiled the way a quest is: a party-wide flag, per-hero
-- exceptions, and the place tree above it having the final word. Hiding Porto
-- hides everyone who lives there.
--
-- What an NPC *is* mechanically is optional and singular: either a stat block
-- from the Den (content_id) or a full character sheet (character_id), never
-- both. The stats carry their own second veil — the party can know the captain
-- long before they may read her numbers — resolved with exactly the same
-- two-layer rule as the NPC itself.
--
-- ON DELETE choices: deleting a place unfiles its people (SET NULL — an NPC
-- survives losing their home, and still carries their own veil, so nothing
-- leaks); deleting a Den monster or a character degrades the NPC back to a
-- name rather than deleting them.

CREATE TABLE npcs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    location_id  UUID REFERENCES locations(id) ON DELETE SET NULL,
    content_id   UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
    -- New NPCs start veiled: the DM drafts a town's worth of faces first.
    visible_to_party       BOOLEAN NOT NULL DEFAULT FALSE,
    stats_visible_to_party BOOLEAN NOT NULL DEFAULT FALSE,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A person is a stat block or a sheet, never both at once.
    CONSTRAINT npcs_one_stats_source CHECK (content_id IS NULL OR character_id IS NULL)
);

CREATE INDEX idx_npcs_campaign ON npcs(campaign_id);
CREATE INDEX idx_npcs_location ON npcs(location_id);

-- Per-hero exceptions to an NPC's party-wide flag, same shape as
-- location_visibility / quest_visibility.
CREATE TABLE npc_visibility (
    npc_id       UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    visible      BOOLEAN NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (npc_id, character_id)
);

CREATE INDEX idx_npc_visibility_character ON npc_visibility(character_id);

-- The same exception table again, for the second veil over the stats. Separate
-- from npc_visibility because the two veils move independently: the ranger who
-- sized the captain up may read her block while the rest only know her name.
CREATE TABLE npc_stat_visibility (
    npc_id       UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    visible      BOOLEAN NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (npc_id, character_id)
);

CREATE INDEX idx_npc_stat_visibility_character ON npc_stat_visibility(character_id);
