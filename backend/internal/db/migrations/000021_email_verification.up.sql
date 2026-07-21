-- Email verification + password recovery for local accounts.
-- OAuth providers already vouch for their users' addresses, so those are
-- marked verified; local accounts start unverified and confirm via a link.

ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET email_verified = true WHERE provider IN ('discord', 'google');

-- Single-use, expiring tokens for the two email flows. We store only the
-- SHA-256 of the token, never the token itself — a leaked table can't be used
-- to verify or reset anyone. The link carries the raw token.
CREATE TABLE email_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,              -- 'verify' | 'reset'
    token_hash TEXT NOT NULL,              -- hex sha-256 of the raw token
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,                -- set when spent; NULL = still valid
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_email_tokens_hash ON email_tokens(token_hash);
CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, purpose);
