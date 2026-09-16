-- The event catalogue's outbox (#315).

-- name: InsertOutboxEvent :exec
INSERT INTO event_outbox (id, campaign_id, name, actor_user_id, audience, payload, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- The DM's feed: newest first, with the actor's name for the reader.
-- name: ListOutboxEventsByCampaign :many
SELECT e.*, u.name AS actor_name
FROM event_outbox e
LEFT JOIN users u ON u.id = e.actor_user_id
WHERE e.campaign_id = $1
ORDER BY e.created_at DESC, e.id
LIMIT $2;
