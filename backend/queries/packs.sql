-- name: ListCampaignPacks :many
SELECT * FROM campaign_packs WHERE campaign_id = $1 ORDER BY name, created_at;

-- name: GetCampaignPack :one
SELECT * FROM campaign_packs WHERE id = $1 AND campaign_id = $2;

-- name: CreateCampaignPack :one
INSERT INTO campaign_packs (campaign_id, name, items, coin)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateCampaignPack :one
UPDATE campaign_packs SET name = $3, items = $4, coin = $5
WHERE id = $1 AND campaign_id = $2
RETURNING *;

-- name: DeleteCampaignPack :exec
DELETE FROM campaign_packs WHERE id = $1 AND campaign_id = $2;

-- name: MarkStartingPack :exec
-- The DM handed these heroes a starting pack just now.
UPDATE characters SET starting_pack_at = now() WHERE id = ANY($1::uuid[]);
