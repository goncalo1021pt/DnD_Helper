-- Core identity & campaign model.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    email       TEXT,
    image       TEXT,
    provider    TEXT NOT NULL,            -- 'discord' | 'google'
    provider_id TEXT NOT NULL,            -- stable id from the provider
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_id)
);

CREATE TABLE campaigns (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user's role is per-campaign: the same account can DM one campaign and
-- play in another.
CREATE TYPE membership_role AS ENUM ('dm', 'player');

CREATE TABLE memberships (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    role        membership_role NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, campaign_id)
);

CREATE INDEX idx_memberships_campaign ON memberships(campaign_id);

-- Session store for alexedwards/scs (pgxstore schema).
CREATE TABLE sessions (
    token  TEXT PRIMARY KEY,
    data   BYTEA NOT NULL,
    expiry TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_expiry ON sessions(expiry);
