-- Locations: an arbitrary-depth place tree per campaign (Portugal > Lisboa >
-- The Rusty Anchor), and the veil the DM draws over it. Quests hang off a
-- location; both locations and quests are revealed to the whole party or to
-- individual heroes, so the DM can draft a region's worth of notices ahead of
-- time and lift the veil at the table.
--
-- Visibility resolves in two steps for a given hero:
--   1. the per-character override, if one exists for that hero
--   2. otherwise the entity's visible_to_party flag
-- A quest is only on a hero's board if the quest AND every location above it
-- resolve visible. Revealing/hiding for the party clears the overrides — the
-- party-wide choice is a reset, not a layer on top.

CREATE TABLE locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    -- Self-reference builds the tree. CASCADE means deleting a region takes
    -- its cities with it; the depth cap (10) is enforced in the API layer.
    parent_id   UUID REFERENCES locations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- New places start drafted: the DM builds the map before the party sees it.
    visible_to_party BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_campaign ON locations(campaign_id);
CREATE INDEX idx_locations_parent ON locations(parent_id);

-- Per-hero exceptions to a location's party-wide flag. A row here means "this
-- hero specifically sees / does not see this place", whatever the party sees.
CREATE TABLE location_visibility (
    location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    visible      BOOLEAN NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (location_id, character_id)
);

CREATE INDEX idx_location_visibility_character ON location_visibility(character_id);

ALTER TABLE quests
    ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    ADD COLUMN visible_to_party BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_quests_location ON quests(location_id);

-- Same per-hero exception table, for quests.
CREATE TABLE quest_visibility (
    quest_id     UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    visible      BOOLEAN NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (quest_id, character_id)
);

CREATE INDEX idx_quest_visibility_character ON quest_visibility(character_id);

-- Backfill. Every quest that already exists was visible to the whole party,
-- and its freeform `location` text becomes a real (revealed) top-level place,
-- so an upgrade changes nothing the players can see.
UPDATE quests SET visible_to_party = TRUE;

INSERT INTO locations (campaign_id, name, visible_to_party)
SELECT DISTINCT campaign_id, btrim(location), TRUE
FROM quests
WHERE location IS NOT NULL AND btrim(location) <> '';

UPDATE quests q
SET location_id = l.id
FROM locations l
WHERE l.campaign_id = q.campaign_id
  AND l.name = btrim(q.location)
  AND q.location IS NOT NULL
  AND btrim(q.location) <> '';
