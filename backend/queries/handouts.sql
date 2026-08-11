-- Handouts. Every read here deliberately omits `image`: the bytes go out over
-- the raw /api/handouts/{id}/image route, never inside a JSON payload, so a
-- listing stays small however many letters the campaign has accumulated.

-- name: CreateHandout :one
INSERT INTO handouts (campaign_id, title, caption, image, content_type, width, height, visible_to_party)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, campaign_id, title, caption, content_type, width, height, visible_to_party, created_at;

-- name: ListHandoutsByCampaign :many
-- The satchel, newest first — the order the table met them in, reversed.
SELECT id, campaign_id, title, caption, content_type, width, height, visible_to_party, created_at
FROM handouts
WHERE campaign_id = $1
ORDER BY created_at DESC;

-- name: GetHandoutMeta :one
SELECT id, campaign_id, title, caption, content_type, width, height, visible_to_party, created_at
FROM handouts
WHERE id = $1;

-- name: GetHandoutImage :one
SELECT image, content_type, created_at
FROM handouts
WHERE id = $1;

-- name: UpdateHandout :one
UPDATE handouts
SET title = $2, caption = $3
WHERE id = $1
RETURNING id, campaign_id, title, caption, content_type, width, height, visible_to_party, created_at;

-- name: DeleteHandout :execrows
DELETE FROM handouts WHERE id = $1;

-- name: SetHandoutPartyVisibility :one
UPDATE handouts
SET visible_to_party = $2
WHERE id = $1
RETURNING id, campaign_id, title, caption, content_type, width, height, visible_to_party, created_at;

-- Per-hero exceptions. Setting the party-wide flag clears these, so a
-- party-wide reveal or hide always wins over stale per-hero rows.

-- name: SetHandoutOverride :exec
INSERT INTO handout_visibility (handout_id, character_id, visible)
VALUES ($1, $2, $3)
ON CONFLICT (handout_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: DeleteHandoutOverride :exec
DELETE FROM handout_visibility WHERE handout_id = $1 AND character_id = $2;

-- name: ClearHandoutOverrides :exec
DELETE FROM handout_visibility WHERE handout_id = $1;

-- name: ListHandoutVisibility :many
SELECT v.handout_id, v.character_id, v.visible, c.name AS character_name
FROM handout_visibility v
JOIN characters c ON c.id = v.character_id
WHERE v.handout_id = $1;

-- name: ListHandoutVisibilityByCampaign :many
SELECT v.handout_id, v.character_id, v.visible, c.name AS character_name
FROM handout_visibility v
JOIN handouts h ON h.id = v.handout_id
JOIN characters c ON c.id = v.character_id
WHERE h.campaign_id = $1;

-- name: AddHandoutEvent :one
-- The chronicle line for a handout being handed over. Its own query rather
-- than a fifth argument on AddEvent, which every other logged moment calls.
INSERT INTO campaign_events (campaign_id, actor_user_id, kind, message, handout_id)
VALUES ($1, $2, 'handout', $3, $4)
RETURNING *;

-- name: GetHandoutEvent :one
-- Does this handout already have its line? Handing it to one more hero later
-- must not write a second one.
SELECT id FROM campaign_events WHERE handout_id = $1 LIMIT 1;
