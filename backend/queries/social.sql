-- name: GetUserByFriendCode :one
SELECT * FROM users WHERE upper(friend_code) = upper($1);

-- name: SetFriendCode :one
UPDATE users SET friend_code = $2 WHERE id = $1 RETURNING *;

-- name: GetFriendship :one
-- The pair's row however it was asked, so a request cannot be duplicated by
-- coming from the other side.
SELECT * FROM friendships
WHERE (requester_id = $1 AND addressee_id = $2)
   OR (requester_id = $2 AND addressee_id = $1);

-- name: AskFriendship :one
INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) RETURNING *;

-- name: AcceptFriendship :one
UPDATE friendships SET state = 'accepted', updated_at = now()
WHERE requester_id = $1 AND addressee_id = $2 AND state = 'pending'
RETURNING *;

-- name: DropFriendship :execrows
DELETE FROM friendships
WHERE (requester_id = $1 AND addressee_id = $2)
   OR (requester_id = $2 AND addressee_id = $1);

-- name: ListFriendships :many
-- Everyone this account is joined to in either direction, with the other
-- person's name — accepted friends and the requests still waiting, since the
-- screen shows all three shelves and one read is enough for it.
SELECT f.requester_id, f.addressee_id, f.state, f.created_at,
       CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS other_id,
       u.name AS other_name, u.image AS other_image
FROM friendships f
JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
WHERE f.requester_id = $1 OR f.addressee_id = $1
ORDER BY f.created_at DESC;

-- name: BlockUser :exec
INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnblockUser :execrows
DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2;

-- name: ListBlocked :many
SELECT b.blocked_id, u.name AS blocked_name
FROM user_blocks b JOIN users u ON u.id = b.blocked_id
WHERE b.blocker_id = $1
ORDER BY u.name;

-- name: BlockedBetween :one
-- Either direction. A block stops the conversation both ways: the blocker does
-- not want to hear from them, and letting the blocked party still send would
-- make it a mute rather than a block.
SELECT EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = $1 AND blocked_id = $2)
       OR (blocker_id = $2 AND blocked_id = $1)
);

-- name: ShareATable :one
-- Whether two accounts sit at any campaign together, which is the other way a
-- conversation may be opened (#181).
SELECT EXISTS (
    SELECT 1 FROM memberships a
    JOIN memberships b ON b.campaign_id = a.campaign_id
    WHERE a.user_id = $1 AND b.user_id = $2
);

-- name: SendDirectMessage :one
INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3) RETURNING *;

-- name: ListDirectMessages :many
-- One thread, oldest first so it reads down the page. Bounded: a room is read
-- from its end, and the whole of a years-long thread is not a page.
SELECT m.*, u.name AS sender_name
FROM direct_messages m
JOIN users u ON u.id = m.sender_id
WHERE (m.sender_id = $1 AND m.recipient_id = $2)
   OR (m.sender_id = $2 AND m.recipient_id = $1)
ORDER BY m.created_at DESC
LIMIT $3;

-- name: ListDirectThreads :many
-- The inbox: one row per person spoken with, their last line, and how many of
-- theirs have arrived since this account last looked.
--
-- DISTINCT ON rather than a LATERAL join, which sqlc's parser cannot resolve
-- from a select list. It forces the ordering to lead with the peer, so the
-- recency the inbox is actually read in is applied by the handler.
SELECT DISTINCT ON (peer.id)
       peer.id AS peer_id, peer.name AS peer_name, peer.image AS peer_image,
       m.body AS last_body, m.created_at AS last_at,
       (m.sender_id = $1) AS last_was_mine,
       (SELECT count(*) FROM direct_messages x
        WHERE x.sender_id = peer.id AND x.recipient_id = $1
          AND x.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)) AS unread
FROM direct_messages m
JOIN users peer ON peer.id = CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
LEFT JOIN direct_reads r ON r.user_id = $1 AND r.peer_id = peer.id
WHERE m.sender_id = $1 OR m.recipient_id = $1
ORDER BY peer.id, m.created_at DESC;

-- name: MarkDirectRead :exec
INSERT INTO direct_reads (user_id, peer_id, last_read_at) VALUES ($1, $2, now())
ON CONFLICT (user_id, peer_id) DO UPDATE SET last_read_at = now();

-- name: SendPartyMessage :one
INSERT INTO party_messages (party_id, author_id, body) VALUES ($1, $2, $3) RETURNING *;

-- name: ListPartyMessages :many
SELECT m.*, u.name AS author_name
FROM party_messages m
JOIN users u ON u.id = m.author_id
WHERE m.party_id = $1
ORDER BY m.created_at DESC
LIMIT $2;

-- name: MarkPartyRead :exec
INSERT INTO party_reads (user_id, party_id, last_read_at) VALUES ($1, $2, now())
ON CONFLICT (user_id, party_id) DO UPDATE SET last_read_at = now();

-- name: UnreadPartyMessages :one
SELECT count(*) FROM party_messages m
LEFT JOIN party_reads r ON r.user_id = $2 AND r.party_id = m.party_id
WHERE m.party_id = $1
  AND m.author_id <> $2
  AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz);

-- name: CountWaiting :one
-- What is waiting on one account: requests to answer, and words unread. Both
-- ride the /me payload the shell already fetches, so the badge in the header
-- costs no request of its own (#181) — a global poll for a number is how a
-- header quietly becomes the most expensive thing on every page.
SELECT
    (SELECT count(*) FROM friendships
      WHERE addressee_id = $1 AND state = 'pending') AS requests,
    (SELECT count(*) FROM direct_messages m
       LEFT JOIN direct_reads r ON r.user_id = $1 AND r.peer_id = m.sender_id
      WHERE m.recipient_id = $1
        AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)) AS unread;
