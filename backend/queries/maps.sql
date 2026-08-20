-- name: CreateMap :one
INSERT INTO maps (campaign_id, parent_map_id, name, image, content_type, width, height, location_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, campaign_id, parent_map_id, name, fog_enabled, width, height, created_at, location_id;

-- name: ListMapsByCampaign :many
-- The atlas shelf: every map of the campaign, oldest first, no image bytes.
-- The place a map depicts rides along by name (#229).
SELECT m.id, m.campaign_id, m.parent_map_id, m.name, m.fog_enabled, m.width, m.height, m.created_at,
       m.location_id, l.name AS location_name
FROM maps m
LEFT JOIN locations l ON l.id = m.location_id
WHERE m.campaign_id = $1
ORDER BY m.created_at;

-- name: GetMapMeta :one
SELECT id, campaign_id, parent_map_id, name, fog_enabled, width, height, created_at, location_id
FROM maps
WHERE id = $1;

-- name: GetMapImage :one
SELECT image, content_type, created_at
FROM maps
WHERE id = $1;

-- name: UpdateMapMeta :one
UPDATE maps
SET name = $2, parent_map_id = $3, fog_enabled = $4, location_id = $5
WHERE id = $1
RETURNING id, campaign_id, parent_map_id, name, fog_enabled, width, height, created_at, location_id;

-- name: DeleteMap :execrows
DELETE FROM maps WHERE id = $1;

-- name: CreateMapPin :one
INSERT INTO map_pins (map_id, label, note, x, y, dm_only, link_map_id, shape)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
SET label = $2, note = $3, x = $4, y = $5, dm_only = $6, link_map_id = $7, shape = $8
WHERE id = $1
RETURNING *;

-- name: DeleteMapPin :execrows
DELETE FROM map_pins WHERE id = $1;

-- name: ListMapShapes :many
SELECT * FROM map_shapes WHERE map_id = $1 ORDER BY created_at;

-- name: GetMapShape :one
-- A shape with its map's campaign, so handlers gate on membership in one read.
SELECT s.*, m.campaign_id
FROM map_shapes s
JOIN maps m ON m.id = s.map_id
WHERE s.id = $1;

-- name: CreateMapShape :one
INSERT INTO map_shapes (map_id, kind, label, points, color, dashed, width, opacity, dm_only, location_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: UpdateMapShape :one
UPDATE map_shapes
SET label = $2, points = $3, color = $4, dashed = $5, width = $6,
    opacity = $7, dm_only = $8, location_id = $9, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteMapShape :execrows
DELETE FROM map_shapes WHERE id = $1;
