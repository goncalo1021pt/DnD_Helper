-- Veiled sheets: a table where the heroes are strangers to one another. When
-- the DM draws the veil, a hero's numbers — class, level, HP, abilities,
-- skills, their whole sheet — belong to their owner and the DM alone; every
-- other player sees a name and nothing more.
--
-- The veil lifts one hero at a time: a row here means "this hero's sheet is
-- open to the party", whatever the campaign flag says. The rows are kept even
-- while the veil is down, so lowering and raising it again remembers who was
-- standing in the light.

ALTER TABLE campaigns ADD COLUMN hidden_sheets BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE character_reveals (
    campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    revealed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, character_id)
);

CREATE INDEX idx_character_reveals_character ON character_reveals(character_id);
