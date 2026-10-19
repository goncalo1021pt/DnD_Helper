ALTER TABLE users ADD COLUMN friend_code TEXT;
UPDATE users SET friend_code =
    upper(translate(substring(replace(id::text, '-', ''), 1, 8), '01', 'wx'));
ALTER TABLE users ALTER COLUMN friend_code SET NOT NULL;
ALTER TABLE users ALTER COLUMN friend_code
    SET DEFAULT upper(translate(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8), '01', 'wx'));
CREATE UNIQUE INDEX idx_users_friend_code ON users (upper(friend_code));

DROP INDEX IF EXISTS idx_users_friend_tag;
DROP TRIGGER IF EXISTS users_friend_tag ON users;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_friend_tag_digits;
ALTER TABLE users DROP COLUMN IF EXISTS friend_tag;
DROP FUNCTION IF EXISTS users_friend_tag();
DROP FUNCTION IF EXISTS draw_friend_tag();
