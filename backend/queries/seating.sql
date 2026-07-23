-- Seating approval: the barred door and the heroes waiting at it.

-- name: SetSeatingApproval :one
UPDATE campaigns SET require_seating_approval = $2 WHERE id = $1 RETURNING *;

-- name: UpsertSeatRequest :exec
-- A hero waits at one door at a time; asking elsewhere moves the request.
INSERT INTO seat_requests (character_id, campaign_id)
VALUES ($1, $2)
ON CONFLICT (character_id) DO UPDATE SET campaign_id = EXCLUDED.campaign_id, created_at = now();

-- name: GetSeatRequest :one
SELECT * FROM seat_requests WHERE character_id = $1;

-- name: DeleteSeatRequest :execrows
DELETE FROM seat_requests WHERE character_id = $1;

-- name: ListSeatRequests :many
-- Everyone waiting at this campaign's door, oldest first.
SELECT sr.character_id, sr.created_at, c.name, c.class, c.level, u.name AS owner_name
FROM seat_requests sr
JOIN characters c ON c.id = sr.character_id
JOIN users u ON u.id = c.owner_user_id
WHERE sr.campaign_id = $1
ORDER BY sr.created_at;

-- name: ListMySeatRequests :many
-- The caller's own heroes still waiting at a door.
SELECT sr.character_id, sr.campaign_id, ca.name AS campaign_name
FROM seat_requests sr
JOIN characters c ON c.id = sr.character_id
JOIN campaigns ca ON ca.id = sr.campaign_id
WHERE c.owner_user_id = $1
ORDER BY sr.created_at;

-- name: DeleteSeatRequestsOfUser :exec
-- A kicked or banned player's heroes leave the door queue too.
DELETE FROM seat_requests sr
USING characters c
WHERE c.id = sr.character_id
  AND c.owner_user_id = $1
  AND sr.campaign_id = $2;
