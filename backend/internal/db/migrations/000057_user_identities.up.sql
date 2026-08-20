-- One person, one account, however many doors (#269).
--
-- Migration 20 scoped the email index to `provider = 'local'` on purpose, and
-- said why: "two different OAuth providers can legitimately hand us the same
-- address, and we don't link accounts yet". That deferred decision has come
-- due. Signing in with Google after registering with a password produced a
-- SECOND account on the same address — campaigns, heroes and homebrew split
-- across two identities belonging to one person, with no way to put them back
-- together, and an unverified squatter able to sit on somebody else's address.
--
-- The reason one account could not answer to two doors is that `users` holds
-- exactly one (provider, provider_id). So the ways in move to their own table
-- and stop being a property of the account:
--
--   users            — who somebody is
--   user_identities  — the doors they may come in by
--
-- `users.provider` stays, and stops being a key. It now means only how an
-- account was BORN, which is the one question still asked of it: 'local' is
-- what makes an account a password account, and that is what gates 2FA and
-- password recovery. A local account that later links Google is still a
-- password account; it simply has two doors.

CREATE TABLE user_identities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_id)
);

CREATE INDEX idx_user_identities_user ON user_identities(user_id);

-- Every account that exists already has exactly one door, and it is the pair
-- the old unique constraint was holding. Carrying it over verbatim means no
-- session, no sign-in and no account changes on the day this ships.
INSERT INTO user_identities (user_id, provider, provider_id, created_at)
SELECT id, provider, provider_id, created_at FROM users;

-- The duplicates that already exist have to be resolved before the address can
-- be made unique. The rule is the one the new door will enforce from now on,
-- applied backwards: the account that held the address FIRST keeps it, because
-- had linking existed, the later account could never have taken it.
--
-- Nothing is deleted and nothing is moved. The later account keeps its rows,
-- its username and its password; it loses only the address, which was never
-- rightfully its own. It loses password RECOVERY with it, though, so this is
-- not something to do quietly: each one is written into admin_actions, which
-- is the table the runbook already tells an operator to read after an upgrade.
-- (A RAISE NOTICE would not do — golang-migrate does not surface them, so it
-- would shout into a void.)
WITH freed AS (
    SELECT u.id, trim(u.email) AS email, u.provider, u.username
    FROM users u
    WHERE nullif(trim(u.email), '') IS NOT NULL
      AND u.id <> (
          SELECT o.id FROM users o
          WHERE lower(nullif(trim(o.email), '')) = lower(trim(u.email))
          ORDER BY o.created_at, o.id
          LIMIT 1
      )
), recorded AS (
    INSERT INTO admin_actions (action, target_user_id, target_label, note)
    SELECT 'email_freed', f.id, coalesce(f.username, f.provider),
           'Migration 57 (#269): ' || f.email || ' was held by more than one account. '
           || 'The account that held it first keeps it; this ' || f.provider
           || ' account keeps its data and its sign-in but loses the address, and with it password recovery.'
    FROM freed f
    RETURNING target_user_id
)
UPDATE users SET email = NULL, email_verified = FALSE
WHERE id IN (SELECT target_user_id FROM recorded);

-- An address now names one account, whoever it came from.
DROP INDEX IF EXISTS idx_users_local_email;
CREATE UNIQUE INDEX idx_users_email ON users (lower(email))
    WHERE nullif(trim(email), '') IS NOT NULL;
