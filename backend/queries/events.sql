-- name: AddEvent :one
INSERT INTO campaign_events (campaign_id, actor_user_id, kind, message)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListEvents :many
-- The chronicle, newest first, with the actor's name.
SELECT e.*, u.name AS actor_name
FROM campaign_events e
LEFT JOIN users u ON u.id = e.actor_user_id
WHERE e.campaign_id = $1
ORDER BY e.created_at DESC
LIMIT $2;
