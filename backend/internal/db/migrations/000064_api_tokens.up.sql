-- API tokens (#294): a door onto a person for scripts, an AI, another service.
--
-- A token acts as its owner within the scopes it was minted with (#313), and
-- optionally within one table only. Only the SHA-256 of the secret is stored —
-- the raw token is shown once at creation and never again, as email_tokens
-- already does — plus its first characters, so a token found in the wild can be
-- matched to its row without being usable. Revocation is a timestamp rather
-- than a delete so the row remains as a record; the listing and the lookup
-- both ignore revoked rows. A token restricted to a table dies with it.
CREATE TABLE api_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,                 -- 'qb_' + the first 8 characters, for display
    token_hash   TEXT NOT NULL,                 -- hex sha-256 of the whole raw token
    scopes       TEXT[] NOT NULL,               -- from the vocabulary in auth/scopes.go
    campaign_id  UUID REFERENCES campaigns(id) ON DELETE CASCADE,  -- NULL = every table the owner sits at
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,                   -- written at most once a minute
    expires_at   TIMESTAMPTZ,                   -- NULL = never
    revoked_at   TIMESTAMPTZ                    -- NULL = live
);
CREATE UNIQUE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id, created_at DESC);
