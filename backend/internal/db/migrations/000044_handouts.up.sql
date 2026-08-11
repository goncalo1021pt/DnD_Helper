-- Handouts: the letter, the torn map corner, the sigil burned into the door.
-- Things a DM hands the table mid-session, which until now had to be dropped
-- in a chat window the app does not have.
--
-- An image lives here rather than in campaign_events because the chronicle is
-- a ledger of pre-rendered lines that every member reads — it carries no bytes
-- and no veil. A handout needs both, so it gets its own row and the chronicle
-- points at it: a line with handout_id is only on your page if the handout it
-- names resolves visible for you. Revealing to one more hero later therefore
-- lights up the line that is already there instead of writing a second one.
--
-- Visibility resolves exactly the way locations and quests do (000030): the
-- per-character override if one exists, otherwise visible_to_party.
CREATE TABLE handouts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    caption     TEXT NOT NULL DEFAULT '',
    image       BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    width       INT NOT NULL,
    height      INT NOT NULL,
    -- New handouts start veiled: the DM prepares the prop before the reveal.
    visible_to_party BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_handouts_campaign ON handouts(campaign_id, created_at DESC);

-- Per-hero exceptions to the party-wide veil — "the rogue alone reads this".
CREATE TABLE handout_visibility (
    handout_id   UUID NOT NULL REFERENCES handouts(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    visible      BOOLEAN NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (handout_id, character_id)
);

CREATE INDEX idx_handout_visibility_character ON handout_visibility(character_id);

-- The chronicle line for "the DM handed this over". CASCADE because a line
-- pointing at a struck handout is a line about nothing.
ALTER TABLE campaign_events
    ADD COLUMN handout_id UUID REFERENCES handouts(id) ON DELETE CASCADE;
