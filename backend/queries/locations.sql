-- name: ListLocationsByCampaign :many
SELECT * FROM locations WHERE campaign_id = $1 ORDER BY name;

-- name: GetLocation :one
SELECT * FROM locations WHERE id = $1;

-- name: CreateLocation :one
INSERT INTO locations (campaign_id, parent_id, name, description, visible_to_party)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateLocation :one
UPDATE locations
SET name        = $2,
    description = $3,
    parent_id   = $4,
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: DeleteLocation :exec
DELETE FROM locations WHERE id = $1;

-- name: SetLocationPartyVisibility :one
UPDATE locations
SET visible_to_party = $2,
    updated_at       = now()
WHERE id = $1
RETURNING *;

-- Per-hero exceptions. Setting the party-wide flag clears these, so a
-- party-wide reveal or hide always wins over stale per-hero rows.

-- name: SetLocationOverride :exec
INSERT INTO location_visibility (location_id, character_id, visible)
VALUES ($1, $2, $3)
ON CONFLICT (location_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: DeleteLocationOverride :exec
DELETE FROM location_visibility WHERE location_id = $1 AND character_id = $2;

-- name: ClearLocationOverrides :exec
DELETE FROM location_visibility WHERE location_id = $1;

-- name: ListLocationVisibilityByCampaign :many
SELECT v.location_id, v.character_id, v.visible, c.name AS character_name
FROM location_visibility v
JOIN locations l ON l.id = v.location_id
JOIN characters c ON c.id = v.character_id
WHERE l.campaign_id = $1;

-- name: CountQuestsInLocation :one
SELECT count(*) FROM quests WHERE location_id = $1;

-- Erasing a place cascades to the places nested inside it and unpins every
-- notice hanging in any of them. Stamp the current names onto those notices
-- first, so a notice still remembers where it hung — by the right name.
-- name: RememberLocationNamesBeforeDelete :exec
WITH RECURSIVE subtree(loc_id, loc_name) AS (
    SELECT root.id, root.name FROM locations root WHERE root.id = $1
    UNION ALL
    SELECT child.id, child.name
    FROM locations child
    JOIN subtree ON child.parent_id = subtree.loc_id
)
UPDATE quests q
SET location = subtree.loc_name
FROM subtree
WHERE q.location_id = subtree.loc_id;
