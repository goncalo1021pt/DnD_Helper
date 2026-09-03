-- name: ListLocationsByCampaign :many
-- The realm's places as ONE table knows them (#234): every place on the
-- campaign's realm, with this campaign's own visible_to_party overlaid. No
-- state row reads as veiled — a table founded on old ground starts dark, and
-- its DM reveals as the party finds things.
SELECT l.*, COALESCE(s.visible_to_party, false)::boolean AS visible_to_party
FROM locations l
JOIN campaigns c ON c.realm_id = l.realm_id
LEFT JOIN location_campaign_state s ON s.location_id = l.id AND s.campaign_id = c.id
WHERE c.id = sqlc.arg(campaign_id)
ORDER BY l.name;

-- name: GetLocation :one
SELECT * FROM locations WHERE id = $1;

-- name: GetLocationForCampaign :one
-- A place THROUGH one table (#234): the row plus that table's flag — and no
-- row at all when the place is not on the campaign's realm, so a place you do
-- not stand on cannot be told from one that never was.
SELECT l.*, COALESCE(s.visible_to_party, false)::boolean AS visible_to_party
FROM locations l
JOIN campaigns c ON c.realm_id = l.realm_id
LEFT JOIN location_campaign_state s ON s.location_id = l.id AND s.campaign_id = c.id
WHERE l.id = sqlc.arg(location_id) AND c.id = sqlc.arg(campaign_id);

-- name: CreateLocation :one
-- Ground: the place is charted onto the realm (#234). What the charting table
-- knows of it is written separately, into location_campaign_state.
INSERT INTO locations (realm_id, parent_id, name, description)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- Text only. Moving a place is MoveLocation, so that a rename can never touch
-- the tree — see the note on UpdateLocationRequest in openapi.yaml.
-- name: UpdateLocation :one
UPDATE locations
SET name        = $2,
    description = $3,
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: MoveLocation :one
UPDATE locations
SET parent_id  = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteLocation :exec
DELETE FROM locations WHERE id = $1;

-- name: SetLocationPartyVisibility :exec
-- One table's flag on a place (#234) — an upsert, because "no row" is the
-- veiled default and a first reveal is what creates the row.
INSERT INTO location_campaign_state (location_id, campaign_id, visible_to_party)
VALUES ($1, $2, $3)
ON CONFLICT (location_id, campaign_id)
DO UPDATE SET visible_to_party = EXCLUDED.visible_to_party, updated_at = now();

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
-- Per-hero exceptions for one table: the overrides of heroes SEATED at this
-- campaign (#234). A hero sits at one table, so the rows were always its.
SELECT v.location_id, v.character_id, v.visible, c.name AS character_name
FROM location_visibility v
JOIN characters c ON c.id = v.character_id
WHERE c.campaign_id = sqlc.arg(campaign_id)::uuid;

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
