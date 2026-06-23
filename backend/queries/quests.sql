-- name: ListQuestsByCampaign :many
SELECT * FROM quests WHERE campaign_id = $1 ORDER BY created_at DESC;

-- name: GetQuest :one
SELECT * FROM quests WHERE id = $1;

-- name: CreateQuest :one
INSERT INTO quests (campaign_id, title, description, giver, location, difficulty, status, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: UpdateQuest :one
UPDATE quests
SET title       = $2,
    description = $3,
    giver       = $4,
    location    = $5,
    difficulty  = $6,
    status      = $7,
    updated_at  = now()
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
SELECT c.quest_id, c.user_id, c.claimed_at, u.name AS user_name
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
