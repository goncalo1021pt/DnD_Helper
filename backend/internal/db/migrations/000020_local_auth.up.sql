-- Local (username + password) accounts, alongside the OAuth providers.
-- A local user registers with an email, a username, and a password; they may
-- then sign in with EITHER their username or their email. OAuth users leave
-- both new columns NULL and keep authenticating through their provider.

ALTER TABLE users ADD COLUMN username      TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Usernames are unique across everyone who has one, case-insensitively.
CREATE UNIQUE INDEX idx_users_username ON users (lower(username))
    WHERE username IS NOT NULL;

-- Email is only guaranteed unique among LOCAL accounts: two different OAuth
-- providers can legitimately hand us the same address, and we don't link
-- accounts yet, so the constraint is scoped to provider = 'local'.
CREATE UNIQUE INDEX idx_users_local_email ON users (lower(email))
    WHERE provider = 'local';
