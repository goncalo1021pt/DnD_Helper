-- TOTP two-factor authentication for local (username/password) accounts.
-- OAuth users are protected by their provider, so 2FA only applies to the
-- password login path.
--
-- The shared TOTP secret must be reversible (we recompute codes from it), so it
-- is stored ENCRYPTED at rest — AES-256-GCM under a key derived from
-- SESSION_KEY. A leaked users table alone therefore can't generate anyone's
-- codes. Recovery codes, like passwords, are stored only as SHA-256 hashes and
-- are single-use.

ALTER TABLE users ADD COLUMN totp_secret  TEXT;                     -- encrypted base32 secret; NULL = not enrolled
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE twofa_recovery_codes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,              -- hex sha-256 of the raw recovery code
    used_at    TIMESTAMPTZ,               -- set when spent; NULL = still usable
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_twofa_recovery_user ON twofa_recovery_codes(user_id);
CREATE UNIQUE INDEX idx_twofa_recovery_hash ON twofa_recovery_codes(code_hash);
