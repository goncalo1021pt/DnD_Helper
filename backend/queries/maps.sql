-- name: CreateMap :one
-- Ground: a map hung on the realm (#234). The hanging table's veil over it is
-- written separately, into map_campaign_state.
INSERT INTO maps (realm_id, parent_map_id, name, image, content_type, width, height, location_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, realm_id, parent_map_id, name, fog_enabled, width, height, created_at, location_id;

-- name: ListMapsByCampaign :many
-- The atlas shelf as ONE table sees it (#234): every map on the campaign's
-- realm, oldest first, no image bytes, with this campaign's own veil overlaid
-- (no state row = veiled). The place a map depicts rides along by name (#229).
SELECT m.id, m.realm_id, c.id AS campaign_id, m.parent_map_id, m.name, m.fog_enabled, m.width, m.height,
       m.created_at, m.location_id, COALESCE(s.visible_to_party, false)::boolean AS visible_to_party,
       l.name AS location_name
FROM maps m
JOIN campaigns c ON c.realm_id = m.realm_id
LEFT JOIN map_campaign_state s ON s.map_id = m.id AND s.campaign_id = c.id
LEFT JOIN locations l ON l.id = m.location_id
WHERE c.id = sqlc.arg(campaign_id)
ORDER BY m.created_at;

-- name: GetMapMeta :one
-- The ground row alone, for realm checks that need no lens — a parent, a link
-- target. Everything a viewer reads goes through GetMapMetaForCampaign.
SELECT id, realm_id, parent_map_id, name, fog_enabled, width, height, created_at, location_id
FROM maps
WHERE id = $1;

-- name: GetMapMetaForCampaign :one
-- A map THROUGH one table (#234): the row with that table's veil overlaid, and
-- no row at all when the map is not on the campaign's realm — the same 404 as
-- a map that never was, which is the whole point of the veil.
SELECT m.id, m.realm_id, c.id AS campaign_id, m.parent_map_id, m.name, m.fog_enabled, m.width, m.height,
       m.created_at, m.location_id, COALESCE(s.visible_to_party, false)::boolean AS visible_to_party
FROM maps m
JOIN campaigns c ON c.realm_id = m.realm_id
LEFT JOIN map_campaign_state s ON s.map_id = m.id AND s.campaign_id = c.id
WHERE m.id = sqlc.arg(map_id) AND c.id = sqlc.arg(campaign_id);

-- name: GetMapImage :one
SELECT image, content_type, created_at
FROM maps
WHERE id = $1;

-- name: UpdateMapMeta :one
UPDATE maps
SET name = $2, parent_map_id = $3, fog_enabled = $4, location_id = $5
WHERE id = $1
RETURNING id, realm_id, parent_map_id, name, fog_enabled, width, height, created_at, location_id;

-- name: DeleteMap :execrows
DELETE FROM maps WHERE id = $1;

-- name: CreateMapPin :one
INSERT INTO map_pins (map_id, label, note, x, y, dm_only, link_map_id, shape)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListMapPins :many
SELECT * FROM map_pins WHERE map_id = $1 ORDER BY created_at;

-- name: GetMapPin :one
-- A pin THROUGH one table (#234): its map must stand on the campaign's realm,
-- else no row. The realm rides along for the link-target check.
SELECT p.*, m.realm_id
FROM map_pins p
JOIN maps m ON m.id = p.map_id
JOIN campaigns c ON c.realm_id = m.realm_id
WHERE p.id = sqlc.arg(pin_id) AND c.id = sqlc.arg(campaign_id);

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
-- A shape THROUGH one table (#234): its map must stand on the campaign's
-- realm, else no row. The realm rides along for the place check.
SELECT s.*, m.realm_id
FROM map_shapes s
JOIN maps m ON m.id = s.map_id
JOIN campaigns c ON c.realm_id = m.realm_id
WHERE s.id = sqlc.arg(shape_id) AND c.id = sqlc.arg(campaign_id);

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

-- The veil over a map's very existence (#276). Same two layers as everything
-- else in a campaign: one party-wide flag, per-hero exceptions over it. The
-- flag is one table's (#234) — an upsert, because "no row" is the veiled
-- default and a first reveal is what creates the row.

-- name: SetMapPartyVisibility :exec
INSERT INTO map_campaign_state (map_id, campaign_id, visible_to_party)
VALUES ($1, $2, $3)
ON CONFLICT (map_id, campaign_id)
DO UPDATE SET visible_to_party = EXCLUDED.visible_to_party, updated_at = now();

-- name: SetMapOverride :exec
INSERT INTO map_visibility (map_id, character_id, visible)
VALUES ($1, $2, $3)
ON CONFLICT (map_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: DeleteMapOverride :exec
DELETE FROM map_visibility WHERE map_id = $1 AND character_id = $2;

-- name: ClearMapOverrides :exec
DELETE FROM map_visibility WHERE map_id = $1;

-- name: ListMapVisibilityByCampaign :many
-- Per-hero exceptions for one table: the overrides of heroes SEATED at this
-- campaign (#234). A hero sits at one table, so the rows were always its.
SELECT v.map_id, v.character_id, v.visible, c.name AS character_name
FROM map_visibility v
JOIN characters c ON c.id = v.character_id
WHERE c.campaign_id = sqlc.arg(campaign_id)::uuid;
