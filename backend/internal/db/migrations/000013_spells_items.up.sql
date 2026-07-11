-- Spells & equipment: two new content kinds, a hero's spell list and
-- inventory as junction tables, and in-session spell-slot state.
ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'spell';
ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'item';

-- Slots used per spell level (index 0 = level 1); max slots are game math
-- computed in the rules engine, not stored.
ALTER TABLE characters
    ADD COLUMN spell_slots_used SMALLINT[] NOT NULL DEFAULT '{}';

CREATE TABLE character_spells (
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    content_id   UUID NOT NULL REFERENCES rules_content(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, content_id)
);
CREATE INDEX idx_character_spells_content ON character_spells(content_id);

CREATE TABLE character_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- content_id null = a free-text row; name is snapshotted at add time so
    -- deleting homebrew content degrades the row instead of losing it.
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    content_id   UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    qty          INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
    equipped     BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_character_items_character ON character_items(character_id);
