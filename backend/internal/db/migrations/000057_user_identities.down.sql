DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX idx_users_local_email ON users (lower(email))
    WHERE provider = 'local';
DROP INDEX IF EXISTS idx_user_identities_user;
DROP TABLE IF EXISTS user_identities;
