-- name: ListNpcs :many
-- Everyone in a campaign, with the place they are found in, the Den block or
-- the sheet behind them. Redaction is the handler's job — this hands over
-- everything and the caller decides what the viewer is allowed to see.
SELECT n.*,
       l.name AS location_name,
       c.name AS character_name,
       (c.class_id IS NOT NULL) AS character_forged,
       -- A sheet-backed ally's hit points live on the sheet, which is the only
       -- place that can hold them; the person's own hp_current stays NULL.
       c.hp_current AS character_hp_current,
       c.hp_max AS character_hp_max,
       cu.name AS control_user_name,
       rc.kind AS content_kind, rc.source AS content_source,
       rc.name AS content_name, rc.summary AS content_summary,
       rc.data AS content_data
FROM npcs n
LEFT JOIN locations l ON l.id = n.location_id
LEFT JOIN characters c ON c.id = n.character_id
LEFT JOIN users cu ON cu.id = n.control_user_id
LEFT JOIN rules_content rc ON rc.id = n.content_id
WHERE n.campaign_id = $1
ORDER BY l.name NULLS LAST, n.name;

-- name: GetNpc :one
SELECT * FROM npcs WHERE id = $1;

-- name: CreateNpc :one
INSERT INTO npcs (campaign_id, name, description, location_id, content_id, character_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateNpc :one
UPDATE npcs
SET name = $2, description = $3, location_id = $4, content_id = $5, character_id = $6, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteNpc :execrows
DELETE FROM npcs WHERE id = $1;

-- name: SetNpcPartyVisibility :one
UPDATE npcs
SET visible_to_party = $2,
    updated_at       = now()
WHERE id = $1
RETURNING *;

-- name: SetNpcStatsPartyVisibility :one
UPDATE npcs
SET stats_visible_to_party = $2,
    updated_at             = now()
WHERE id = $1
RETURNING *;

-- Per-hero exceptions. Setting the party-wide flag clears these, so a
-- party-wide reveal or hide always wins over stale per-hero rows.

-- name: SetNpcOverride :exec
INSERT INTO npc_visibility (npc_id, character_id, visible)
VALUES ($1, $2, $3)
ON CONFLICT (npc_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: DeleteNpcOverride :exec
DELETE FROM npc_visibility WHERE npc_id = $1 AND character_id = $2;

-- name: ClearNpcOverrides :exec
DELETE FROM npc_visibility WHERE npc_id = $1;

-- name: SetNpcStatOverride :exec
INSERT INTO npc_stat_visibility (npc_id, character_id, visible)
VALUES ($1, $2, $3)
ON CONFLICT (npc_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: DeleteNpcStatOverride :exec
DELETE FROM npc_stat_visibility WHERE npc_id = $1 AND character_id = $2;

-- name: ClearNpcStatOverrides :exec
DELETE FROM npc_stat_visibility WHERE npc_id = $1;

-- name: ListNpcVisibilityByCampaign :many
SELECT v.npc_id, v.character_id, v.visible, c.name AS character_name
FROM npc_visibility v
JOIN npcs n ON n.id = v.npc_id
JOIN characters c ON c.id = v.character_id
WHERE n.campaign_id = $1;

-- name: ListNpcStatVisibilityByCampaign :many
SELECT v.npc_id, v.character_id, v.visible, c.name AS character_name
FROM npc_stat_visibility v
JOIN npcs n ON n.id = v.npc_id
JOIN characters c ON c.id = v.character_id
WHERE n.campaign_id = $1;

-- name: SetNpcTravel :one
-- Whether a person walks with the party, and who runs them (#228). Traveling
-- opens the veil on their existence with the same stroke: an ally the party
-- has never heard of is a contradiction. Their stats veil is left alone.
UPDATE npcs
SET traveling       = $2,
    control         = $3,
    control_user_id = $4,
    visible_to_party = CASE WHEN $2 THEN TRUE ELSE visible_to_party END,
    updated_at      = now()
WHERE id = $1
RETURNING *;

-- name: SetNpcHp :one
-- What a stat-block-backed ally has left. A sheet-backed one never lands here:
-- their hit points belong to the sheet and are written there.
UPDATE npcs SET hp_current = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListTravelingNpcs :many
-- The allies walking with a party, for the encounter builder and the roster.
SELECT * FROM npcs WHERE campaign_id = $1 AND traveling ORDER BY name;
