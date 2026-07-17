-- The Bestiary: the party's field journal of creatures they've met. Each
-- entry is a player-named sighting that the DM can later identify (link to a
-- Den monster) and unveil section by section. Field notes are their own
-- stream — player-authored observations the official record never overwrites.
CREATE TABLE bestiary_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    -- The identified creature, once the DM links it. SET NULL keeps the
    -- entry (and its notes) alive if the monster content is ever deleted.
    content_id  UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    -- Which record sections the DM has unveiled: subset of
    -- {defenses, offense, traits, lore}. Empty until the first reveal.
    revealed    TEXT[] NOT NULL DEFAULT '{}',
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bestiary_entries_campaign ON bestiary_entries(campaign_id);

CREATE TABLE bestiary_notes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id   UUID NOT NULL REFERENCES bestiary_entries(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bestiary_notes_entry ON bestiary_notes(entry_id);
