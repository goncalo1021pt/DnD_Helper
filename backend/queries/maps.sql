-- name: CreateMap :one
INSERT INTO maps (campaign_id, parent_map_id, name, image, content_type, width, height)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, campaign_id, parent_map_id, name, width, height, created_at;

-- name: ListMapsByCampaign :many
-- The atlas shelf: every map of the campaign, oldest first, no image bytes.
SELECT id, campaign_id, parent_map_id, name, width, height, created_at
FROM maps
WHERE campaign_id = $1
ORDER BY created_at;

-- name: GetMapMeta :one
SELECT id, campaign_id, parent_map_id, name, width, height, created_at
FROM maps
WHERE id = $1;

-- name: GetMapImage :one
SELECT image, content_type, created_at
FROM maps
WHERE id = $1;

-- name: UpdateMapMeta :one
UPDATE maps
SET name = $2, parent_map_id = $3
WHERE id = $1
RETURNING id, campaign_id, parent_map_id, name, width, height, created_at;

-- name: DeleteMap :execrows
DELETE FROM maps WHERE id = $1;

-- name: CreateMapPin :one
INSERT INTO map_pins (map_id, label, note, x, y, dm_only, link_map_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListMapPins :many
SELECT * FROM map_pins WHERE map_id = $1 ORDER BY created_at;

-- name: GetMapPin :one
-- A pin with its map's campaign, so handlers can gate on membership in one read.
SELECT p.*, m.campaign_id
FROM map_pins p
JOIN maps m ON m.id = p.map_id
WHERE p.id = $1;

-- name: UpdateMapPin :one
UPDATE map_pins
SET label = $2, note = $3, x = $4, y = $5, dm_only = $6, link_map_id = $7
WHERE id = $1
RETURNING *;

-- name: DeleteMapPin :execrows
DELETE FROM map_pins WHERE id = $1;
