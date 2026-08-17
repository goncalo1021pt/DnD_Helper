-- name: ListQuestsByCampaign :many
SELECT * FROM quests WHERE campaign_id = $1 ORDER BY created_at DESC;

-- name: GetQuest :one
SELECT * FROM quests WHERE id = $1;

-- name: CreateQuest :one
INSERT INTO quests (campaign_id, title, description, giver, location, location_id, visible_to_party, difficulty, status, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: UpdateQuest :one
UPDATE quests
SET title            = $2,
    description      = $3,
    giver            = $4,
    location         = $5,
    location_id      = $6,
    visible_to_party = $7,
    difficulty       = $8,
    status           = $9,
    updated_at       = now()
WHERE id = $1
RETURNING *;

-- name: DeleteQuest :exec
DELETE FROM quests WHERE id = $1;

-- name: ListRewardsByCampaign :many
SELECT r.* FROM quest_rewards r
JOIN quests q ON q.id = r.quest_id
WHERE q.campaign_id = $1;

-- name: ListRewardsForQuest :many
SELECT * FROM quest_rewards WHERE quest_id = $1;

-- name: AddReward :one
INSERT INTO quest_rewards (quest_id, type, label, value)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: DeleteRewardsForQuest :exec
DELETE FROM quest_rewards WHERE quest_id = $1;

-- name: ListClaimsByCampaign :many
-- The claimant's seated heroes ride along so the board can speak in-fiction —
-- "claimed by Sella", not by a login handle (#250). Table-born quick-adds are
-- the DM's stubs, never a claimant's own hero.
SELECT c.quest_id, c.user_id, c.claimed_at, u.name AS user_name,
       (SELECT string_agg(ch.name, ' & ' ORDER BY ch.created_at)
        FROM characters ch
        WHERE ch.owner_user_id = c.user_id
          AND ch.campaign_id = q.campaign_id
          AND NOT ch.table_born) AS hero_name
FROM quest_claims c
JOIN users u ON u.id = c.user_id
JOIN quests q ON q.id = c.quest_id
WHERE q.campaign_id = $1;

-- name: ClaimQuest :exec
INSERT INTO quest_claims (quest_id, user_id)
VALUES ($1, $2)
ON CONFLICT (quest_id, user_id) DO NOTHING;

-- name: UnclaimQuest :exec
DELETE FROM quest_claims WHERE quest_id = $1 AND user_id = $2;

-- Visibility: a party-wide flag on the quest plus per-hero exceptions.

-- name: SetQuestPartyVisibility :one
UPDATE quests
SET visible_to_party = $2,
    updated_at       = now()
WHERE id = $1
RETURNING *;

-- name: SetQuestOverride :exec
INSERT INTO quest_visibility (quest_id, character_id, visible)
VALUES ($1, $2, $3)
ON CONFLICT (quest_id, character_id)
DO UPDATE SET visible = EXCLUDED.visible, updated_at = now();

-- name: DeleteQuestOverride :exec
DELETE FROM quest_visibility WHERE quest_id = $1 AND character_id = $2;

-- name: ClearQuestOverrides :exec
DELETE FROM quest_visibility WHERE quest_id = $1;

-- name: ListQuestVisibilityByCampaign :many
SELECT v.quest_id, v.character_id, v.visible, c.name AS character_name
FROM quest_visibility v
JOIN quests q ON q.id = v.quest_id
JOIN characters c ON c.id = v.character_id
WHERE q.campaign_id = $1;
