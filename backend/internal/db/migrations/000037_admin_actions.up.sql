-- What was done to an account from outside the app (#111).
--
-- One thing needs this today: clearing a user's two-factor auth when they have
-- lost both their authenticator and their recovery codes. There is no admin
-- page and deliberately no endpoint for it — it is a command run on the box,
-- so the only way in is already having the box.
--
-- The row exists because the command runs through `docker compose exec`, whose
-- output never reaches `docker compose logs`. Without this the trail would be
-- whatever was still in a terminal scrollback, which is not a trail.
--
-- There is no actor column on purpose. The actor is whoever had a shell on the
-- production host, and inventing a name for them would record a guess. What is
-- worth recording is the `note`: how the person asking was verified as
-- themselves, which is the only part of this that is hard to get right.

CREATE TABLE admin_actions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action         TEXT NOT NULL,
    -- SET NULL rather than CASCADE: a deleted account is exactly when you most
    -- want the record of what was done to it to survive.
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_label   TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_actions_created ON admin_actions(created_at DESC);
