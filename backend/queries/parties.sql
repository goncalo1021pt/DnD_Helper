-- name: ListParties :many
-- The campaign's parties, each with how many heroes ride with it.
SELECT p.*, count(c.id) AS hero_count
FROM parties p
LEFT JOIN characters c ON c.party_id = p.id AND c.kind = 'hero'
WHERE p.campaign_id = $1
GROUP BY p.id
ORDER BY p.created_at;

-- name: GetParty :one
SELECT * FROM parties WHERE id = $1;

-- name: CreateParty :one
INSERT INTO parties (campaign_id, name) VALUES ($1, $2) RETURNING *;

-- name: RenameParty :one
UPDATE parties SET name = $2 WHERE id = $1 RETURNING *;

-- name: DeleteParty :execrows
-- Disbanding takes nothing from anybody: the heroes' party_id falls to NULL
-- and every stamp they were ever given stays exactly where it is (#232).
DELETE FROM parties WHERE id = $1;

-- name: SetCharacterParty :one
-- Move a hero between parties, or out of all of them (NULL).
UPDATE characters SET party_id = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: ListPartyHeroIDs :many
-- The heroes riding with a party right now. This is read at the moment of a
-- grant and never again: a party is the brush, the per-hero rows are the paint.
SELECT id FROM characters WHERE party_id = $1 AND kind = 'hero' ORDER BY created_at;

-- name: SetQuestOverridesForParty :exec
INSERT INTO quest_visibility (quest_id, character_id, visible)
SELECT $1, c.id, $3 FROM characters c WHERE c.party_id = $2 AND c.kind = 'hero'
ON CONFLICT (quest_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: SetLocationOverridesForParty :exec
INSERT INTO location_visibility (location_id, character_id, visible)
SELECT $1, c.id, $3 FROM characters c WHERE c.party_id = $2 AND c.kind = 'hero'
ON CONFLICT (location_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: SetNpcOverridesForParty :exec
INSERT INTO npc_visibility (npc_id, character_id, visible)
SELECT $1, c.id, $3 FROM characters c WHERE c.party_id = $2 AND c.kind = 'hero'
ON CONFLICT (npc_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: SetNpcStatOverridesForParty :exec
INSERT INTO npc_stat_visibility (npc_id, character_id, visible)
SELECT $1, c.id, $3 FROM characters c WHERE c.party_id = $2 AND c.kind = 'hero'
ON CONFLICT (npc_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: SetHandoutOverridesForParty :exec
INSERT INTO handout_visibility (handout_id, character_id, visible)
SELECT $1, c.id, $3 FROM characters c WHERE c.party_id = $2 AND c.kind = 'hero'
ON CONFLICT (handout_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: ListHeroPartiesByCampaign :many
-- Every seated hero and the party they ride with, for resolving "may this
-- viewer see that hero / that ally" in one read (#232).
SELECT id, owner_user_id, party_id FROM characters
WHERE campaign_id = $1 AND kind = 'hero';
