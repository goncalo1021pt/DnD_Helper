DROP INDEX IF EXISTS idx_users_deletion_due;
ALTER TABLE users
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deletion_requested_at;
