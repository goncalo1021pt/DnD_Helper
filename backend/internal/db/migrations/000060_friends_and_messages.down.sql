DROP TABLE IF EXISTS party_reads;
DROP TABLE IF EXISTS direct_reads;
DROP TABLE IF EXISTS party_messages;
DROP TABLE IF EXISTS direct_messages;
DROP TABLE IF EXISTS user_blocks;
DROP TABLE IF EXISTS friendships;
DROP INDEX IF EXISTS idx_users_friend_code;
ALTER TABLE users DROP COLUMN IF EXISTS friend_code;
