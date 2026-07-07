-- name: ListCharactersByCampaign :many
SELECT c.*, u.name AS owner_name
FROM characters c
JOIN users u ON u.id = c.owner_user_id
WHERE c.campaign_id = $1
ORDER BY c.created_at ASC;

-- name: GetCharacter :one
SELECT * FROM characters WHERE id = $1;

-- name: CreateCharacter :one
INSERT INTO characters (campaign_id, owner_user_id, name, class, level, hp_current, hp_max)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateCharacter :one
UPDATE characters
SET name       = $2,
    class      = $3,
    level      = $4,
    hp_current = $5,
    hp_max     = $6,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteCharacter :exec
DELETE FROM characters WHERE id = $1;

-- name: ListCharactersByOwner :many
-- The user's heroes across all campaigns, including unseated ones.
SELECT c.*, camp.name AS campaign_name
FROM characters c
LEFT JOIN campaigns camp ON camp.id = c.campaign_id
WHERE c.owner_user_id = $1
ORDER BY c.created_at ASC;

-- name: SeatCharacter :one
-- Seat a hero at a campaign (or NULL to return them to My Heroes).
UPDATE characters SET campaign_id = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateAccountCharacter :one
-- A hero created in My Heroes, not yet seated anywhere.
INSERT INTO characters (campaign_id, owner_user_id, name, class, level, hp_current, hp_max)
VALUES (NULL, $1, $2, $3, $4, $5, $6)
RETURNING *;
