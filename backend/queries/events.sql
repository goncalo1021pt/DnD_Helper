-- name: AddEvent :one
INSERT INTO campaign_events (campaign_id, actor_user_id, kind, message)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListEvents :many
-- The chronicle, newest first, with the actor's name and a derived channel
-- category. Pass 'all' to see everything, or a category to filter to one
-- channel (filtering on the computed column so it survives the LIMIT).
WITH ev AS (
    SELECT e.id, e.campaign_id, e.actor_user_id, e.kind, e.message, e.created_at,
           u.name AS actor_name,
           (CASE
                WHEN e.kind = 'note'        THEN 'dm'
                WHEN e.kind = 'ruling'      THEN 'rules'
                WHEN e.kind LIKE 'codex%'   THEN 'rules'
                WHEN e.kind = 'player_note' THEN 'player'
                ELSE 'log'
            END)::text AS category
    FROM campaign_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.campaign_id = $1
)
SELECT * FROM ev
WHERE $2::text = 'all' OR category = $2::text
ORDER BY created_at DESC
LIMIT $3;
