-- name: ListCharactersByCampaign :many
SELECT c.*, u.name AS owner_name, rc_class.data AS class_data
FROM characters c
JOIN users u ON u.id = c.owner_user_id
LEFT JOIN rules_content rc_class ON rc_class.id = c.class_id
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
SELECT c.*, camp.name AS campaign_name, rc_class.data AS class_data
FROM characters c
LEFT JOIN campaigns camp ON camp.id = c.campaign_id
LEFT JOIN rules_content rc_class ON rc_class.id = c.class_id
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

-- name: ForgeCharacter :one
-- A wizard-built hero: full sheet, created unseated in My Heroes.
INSERT INTO characters (
    campaign_id, owner_user_id, name, class, level, hp_current, hp_max,
    strength, dexterity, constitution, intelligence, wisdom, charisma,
    skills, class_id, species_id, background_id
) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING *;

-- name: LevelUpCharacter :one
-- Apply one level: new level/HP, any ability increases (ASI), the chosen
-- subclass when the class reaches it, and any feat taken along the way.
UPDATE characters
SET level = $2,
    hp_max = $3,
    hp_current = $4,
    strength = $5, dexterity = $6, constitution = $7,
    intelligence = $8, wisdom = $9, charisma = $10,
    subclass_id = $11,
    feats = $12,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetSpellSlotsUsed :one
UPDATE characters
SET spell_slots_used = $2, updated_at = now()
WHERE id = $1
RETURNING *;
