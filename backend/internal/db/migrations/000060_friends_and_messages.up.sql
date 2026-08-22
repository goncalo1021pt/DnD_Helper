-- Friends, and talking to them (#181).
--
-- Campaign chat already exists and is called the Chronicle: a live per-campaign
-- feed a player posts to as `player_note`. What was missing is everything
-- OUTSIDE a campaign — knowing somebody across tables, and saying something to
-- one person rather than to the room — plus a channel narrower than the table
-- for a party that has split.

-- ── who you are, to somebody who does not share a table with you ────────────
--
-- Discovery is a CODE you hand out, not a search. The app already has exactly
-- this idiom for campaigns, and it is the right one here for the same reason:
-- a search box over accounts is an enumeration door onto a private tavern, and
-- half these accounts arrived through Google and have no username to be found
-- by anyway. A code is given deliberately, to one person, and can be reforged.
ALTER TABLE users ADD COLUMN friend_code TEXT;

-- Drawn from the id, which is already unique and already random: eight symbols
-- is four billion, and nobody guesses their way in against a rate limiter.
--
-- The two hex digits that are misread when a code is read ALOUD are translated
-- out — 0 for O and 1 for I or L — because this is a thing said across a table
-- or a voice call. Hex has no O, I or L of its own, so those two are the whole
-- of it, and what is left is a sixteen-symbol alphabet with no lookalikes.
-- Go's newFriendCode draws from the same idea, and its test pins it.
UPDATE users SET friend_code =
    upper(translate(substring(replace(id::text, '-', ''), 1, 8), '01', 'wx'));

ALTER TABLE users ALTER COLUMN friend_code SET NOT NULL;

-- Every account born from here on gets one without any INSERT having to know
-- about it. There are four doors into `users` — two OAuth paths, registration
-- and the dev shortcut — and a NOT NULL column with no default would have
-- broken all four the moment this shipped.
ALTER TABLE users ALTER COLUMN friend_code
    SET DEFAULT upper(translate(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8), '01', 'wx'));

CREATE UNIQUE INDEX idx_users_friend_code ON users (upper(friend_code));

-- ── the friendship itself ───────────────────────────────────────────────────
--
-- One row per pair, in the direction it was ASKED, because who asked is a fact
-- worth keeping: it is what a pending request is, and it is what the person
-- deciding needs to see. An accepted row is read from either side.
CREATE TABLE friendships (
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state        TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id),
    CHECK (state IN ('pending', 'accepted'))
);

CREATE INDEX idx_friendships_addressee ON friendships (addressee_id, state);

-- Only ONE row may exist for a pair however it is read, or two people asking
-- each other at the same moment would become two friendships and a request
-- nobody can answer. The index is over the ordered pair, so it catches both.
CREATE UNIQUE INDEX idx_friendships_pair ON friendships (
    least(requester_id, addressee_id), greatest(requester_id, addressee_id)
);

-- Blocking is DIRECTIONAL and is not a friendship state: it survives the
-- friendship being removed, and it is the blocker's own fact rather than a
-- thing the pair agreed to.
CREATE TABLE user_blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- ── what was said ───────────────────────────────────────────────────────────
--
-- Two plain tables rather than a conversation with members: a thread here is
-- derivable — every line between two people, or every line in one party — and
-- a conversation row would be a lifecycle to keep in step with nothing.
CREATE TABLE direct_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sender_id <> recipient_id)
);

-- The index a thread is read by, in both directions.
CREATE INDEX idx_direct_messages_pair ON direct_messages (
    least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at DESC
);
CREATE INDEX idx_direct_messages_inbox ON direct_messages (recipient_id, created_at DESC);

-- A party that has split gets a room narrower than the table (#232).
CREATE TABLE party_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id   UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_party_messages_feed ON party_messages (party_id, created_at DESC);

-- ── what you have already read ──────────────────────────────────────────────
--
-- A high-water mark per room rather than a flag per message: the question ever
-- asked is "anything new?", and a per-message read table would be the largest
-- table in the app answering a question nobody asks.
CREATE TABLE direct_reads (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, peer_id)
);

CREATE TABLE party_reads (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    party_id     UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, party_id)
);
