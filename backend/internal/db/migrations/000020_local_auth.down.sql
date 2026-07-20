DROP INDEX IF EXISTS idx_users_local_email;
DROP INDEX IF EXISTS idx_users_username;
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users DROP COLUMN username;
