-- A realm outlives its campaign (#233).
--
-- One table's setting will host a campaign measured in years, and later maybe
-- another campaign on the same ground — "almost like a reset". The app already
-- solved this shape once, for players: a hero lives at the account and is
-- SEATED into a campaign. The DM's setting deserves the same, authored once and
-- played at many tables.
--
-- This is the container and nothing else. Nothing moves up yet: places, maps,
-- folk and shops all stay campaign property, and two campaigns in one realm see
-- nothing of each other. What it buys is the foreign key and the mental model,
-- so that stage two (#234 — the atlas moves up) is a data migration rather than
-- a schema invention.
--
-- It is called a realm and not a world because "the world" is already taken:
-- inside a campaign it means the place tree, and a container above campaigns
-- wearing the same word would leave two different Worlds in one UI.

CREATE TABLE realms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Whether the owner has ever named this realm, as opposed to it carrying
    -- the name of the campaign that minted it. It decides one thing: an
    -- emptied realm nobody ever named is swept away, because it is a container
    -- nobody set out to make, while a named one stands however empty — that
    -- one is a place, waiting for the next campaign on this ground.
    named         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_realms_owner ON realms(owner_user_id);

-- RESTRICT, not CASCADE: a realm holds campaigns, so striking one out from
-- under them would take years of play with it. Emptying it is the only way out,
-- and an empty realm is a useful thing to keep — it is where the next campaign
-- on this ground begins.
ALTER TABLE campaigns ADD COLUMN realm_id UUID REFERENCES realms(id) ON DELETE RESTRICT;

-- Every campaign that exists gets a realm of its own, named after it, so not a
-- single table reads differently the day this ships.
--
-- The new realm takes the campaign's OWN id. Names repeat — two people may both
-- run "Curse of Strahd" — so matching them back up afterwards would be a guess;
-- the id is the one thing already unique per campaign, and the two tables share
-- no id space. It also means a backfilled realm is recognisable forever: it is
-- the one whose id is its only campaign's.
INSERT INTO realms (id, name, owner_user_id, created_at)
SELECT c.id, c.name, c.owner_user_id, c.created_at FROM campaigns c;

UPDATE campaigns SET realm_id = id;

ALTER TABLE campaigns ALTER COLUMN realm_id SET NOT NULL;

CREATE INDEX idx_campaigns_realm ON campaigns(realm_id);
