-- name: AddEvent :one
INSERT INTO campaign_events (campaign_id, actor_user_id, kind, message)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListEvents :many
-- The chronicle, newest first, with the actor's name and a derived channel
-- category. Pass 'all' to see everything, or a category to filter to one
-- channel (filtering on the computed column so it survives the LIMIT).
-- since/until fence a window and before_at/before_id are a cursor — the oldest
-- line of the previous page — all applied here, so a page is exactly the next
-- lines and not the newest ones filtered afterwards (#424). The id is the
-- tie-break: lines written in one transaction share now(), and a cursor on the
-- time alone would skip or repeat them.
WITH ev AS (
    SELECT e.id, e.campaign_id, e.actor_user_id, e.kind, e.message, e.created_at,
           e.handout_id, e.edited_at,
           u.name AS actor_name,
           (CASE
                WHEN e.kind = 'note'        THEN 'dm'
                WHEN e.kind = 'ruling'      THEN 'rules'
                WHEN e.kind LIKE 'codex%'   THEN 'rules'
                WHEN e.kind = 'handout'     THEN 'dm'
                WHEN e.kind = 'player_note' THEN 'player'
                WHEN e.kind = 'roll'        THEN 'rolls'
                ELSE 'log'
            END)::text AS category
    FROM campaign_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.campaign_id = sqlc.arg(campaign_id)
)
SELECT * FROM ev
WHERE (sqlc.arg(category)::text = 'all' OR category = sqlc.arg(category)::text)
  AND (sqlc.narg(since)::timestamptz IS NULL OR created_at >= sqlc.narg(since)::timestamptz)
  AND (sqlc.narg(until)::timestamptz IS NULL OR created_at < sqlc.narg(until)::timestamptz)
  AND (sqlc.narg(before_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(before_at)::timestamptz, sqlc.narg(before_id)::uuid))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetEventForCampaign :one
-- One line THROUGH its table: no row when it is not that table's, the same 404
-- as a line that never was.
SELECT * FROM campaign_events WHERE id = $1 AND campaign_id = $2;

-- name: EditEventMessage :one
UPDATE campaign_events SET message = $2, edited_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteEvent :execrows
DELETE FROM campaign_events WHERE id = $1;
