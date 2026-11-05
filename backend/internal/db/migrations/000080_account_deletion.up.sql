-- Account deletion (#322). A person asks, waits a week, and is anonymised in
-- place: the users row stays as a tombstone ("a departed player") so every
-- foreign key that points at it keeps working — the other side of a
-- conversation keeps theirs, a chronicle line keeps its place, a quest keeps
-- its author — while everything personal is struck.
--
-- deletion_requested_at is the scheduled state: set when the person confirms,
-- cleared by signing in again, read by the sweep that purges when the grace is
-- up. deleted_at is the tombstone mark, and never clears.
ALTER TABLE users
    ADD COLUMN deletion_requested_at TIMESTAMPTZ,
    ADD COLUMN deleted_at            TIMESTAMPTZ;

-- The sweep reads only the few accounts waiting out their week.
CREATE INDEX idx_users_deletion_due ON users (deletion_requested_at)
    WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
