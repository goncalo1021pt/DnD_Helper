-- A friend is found by their tag, not a code (#387).
--
-- #181 made discovery a code you hand out — `3F9AWC2E` — and it worked, but it
-- was a thing nobody could read off a screen without squinting, and it was not
-- even one alphabet (the backfill and the default drew hex off a UUID, only a
-- reforge drew from the readable set). A tag is your display name and four
-- digits, `Sam#4821`, the way Discord did it: the name is the part people
-- already know, the digits are the part that tells two Sams apart.
--
-- It is still not a search. You type the whole tag or nobody answers, and the
-- misses are counted (`friendMisses` in Go), because knowing somebody is called
-- Sam leaves ten thousand tags to guess.
ALTER TABLE users ADD COLUMN friend_tag TEXT;

-- ── drawing one, wherever a name is written ──────────────────────────────────
--
-- A name is written by five doors — two OAuth paths, a provider refresh (until
-- the name is chosen, #302), registration and `PATCH /me` — and any of them can
-- land a name on digits somebody else already wears with it. So the draw lives
-- here, under every one of them, rather than in five places in Go: a row whose
-- (name, tag) is taken is given fresh digits in the same write. Renaming keeps
-- your digits whenever it can.
CREATE FUNCTION draw_friend_tag() RETURNS text LANGUAGE sql VOLATILE AS $$
    SELECT lpad((floor(random() * 9999) + 1)::int::text, 4, '0')
$$;

CREATE FUNCTION users_friend_tag() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    tries int := 0;
BEGIN
    IF NEW.friend_tag IS NULL THEN
        NEW.friend_tag := draw_friend_tag();
    END IF;
    WHILE EXISTS (
        SELECT 1 FROM users
        WHERE lower(name) = lower(NEW.name) AND friend_tag = NEW.friend_tag AND id <> NEW.id
    ) LOOP
        tries := tries + 1;
        IF tries > 100 THEN
            RAISE EXCEPTION 'no free tag for the name %', NEW.name;
        END IF;
        NEW.friend_tag := draw_friend_tag();
    END LOOP;
    RETURN NEW;
END
$$;

-- Every account that exists gets one, never colliding within its name: the
-- trigger is not on yet, so each row is drawn here one at a time against the
-- rows already drawn.
DO $$
DECLARE
    u record;
    t text;
BEGIN
    FOR u IN SELECT id, name FROM users ORDER BY created_at LOOP
        LOOP
            t := draw_friend_tag();
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM users WHERE lower(name) = lower(u.name) AND friend_tag = t
            );
        END LOOP;
        UPDATE users SET friend_tag = t WHERE id = u.id;
    END LOOP;
END
$$;

ALTER TABLE users ALTER COLUMN friend_tag SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_friend_tag_digits
    CHECK (friend_tag ~ '^[0-9]{4}$' AND friend_tag <> '0000');

CREATE TRIGGER users_friend_tag
    BEFORE INSERT OR UPDATE OF name, friend_tag ON users
    FOR EACH ROW EXECUTE FUNCTION users_friend_tag();

-- What the trigger keeps true, held by the database as well: a tag names one
-- account. The lookup reads this index.
CREATE UNIQUE INDEX idx_users_friend_tag ON users (lower(name), friend_tag);

-- The code retires with this; a code somebody wrote down simply stops answering.
DROP INDEX idx_users_friend_code;
ALTER TABLE users DROP COLUMN friend_code;
