-- The second stat block: forms a hero turns into, companions that fight
-- beside them, and summons that last an encounter.
--
-- Storage is one row per creature a hero carries. The numbers themselves come
-- from three places, in order: the linked library entry's `data`, any `scale`
-- formulas on it evaluated against this hero, and finally `overrides` — the
-- player's own molding, which always wins. A creature with no `content_id` is
-- pure `overrides`, so a hand-written companion needs no library entry at all.
--
-- `role` is not decoration, because the rules differ. A `form` (Wild Shape)
-- replaces the hero's statistics but keeps their hit points, so hp_current
-- stays null on one; a `companion` or `summon` is a separate creature that
-- tracks its own damage.
--
-- Only *current* hit points are stored. The maximum is whatever the resolved
-- block says, which is the only way a companion whose pool is "five times your
-- level" grows when the hero does — storing it would freeze the number at the
-- level it was created, and a player would find out three sessions later.
-- Houseruling the pool is an override on `hp` like any other field.

CREATE TYPE creature_role AS ENUM ('form', 'companion', 'summon');

CREATE TABLE character_creatures (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    role         creature_role NOT NULL DEFAULT 'companion',
    -- The library entry behind this creature (a `monster` content row), or
    -- null for one written by hand. SET NULL rather than CASCADE: deleting a
    -- homebrew monster degrades the hero's companion to its last known
    -- numbers instead of deleting a creature out from under them mid-campaign.
    content_id   UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    -- Display name, snapshotted at creation and renameable — a wolf companion
    -- is somebody's Grey, not "Wolf".
    name         TEXT NOT NULL,
    -- The feature that granted it ("Wild Shape", "Steel Defender"), for the
    -- stamp on the sheet. Free text: it names content this row cannot join to.
    granted_by   TEXT NOT NULL DEFAULT '',
    overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Null means undamaged: a creature that has never been hit needs no row of
    -- its own to say so, and stays at full as its maximum grows.
    hp_current   INTEGER,
    -- Shaped into / currently summoned. At most one active form per hero is a
    -- handler rule, not a constraint: it depends on `role`.
    active       BOOLEAN NOT NULL DEFAULT false,
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT character_creatures_hp_sane CHECK (hp_current IS NULL OR hp_current >= 0)
);

CREATE INDEX idx_character_creatures_character ON character_creatures(character_id);
CREATE INDEX idx_character_creatures_content ON character_creatures(content_id);
