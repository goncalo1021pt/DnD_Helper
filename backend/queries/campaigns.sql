-- name: CreateCampaign :one
INSERT INTO campaigns (name, owner_user_id, invite_code)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetCampaign :one
SELECT * FROM campaigns WHERE id = $1;

-- name: GetCampaignByInviteCode :one
SELECT * FROM campaigns WHERE invite_code = $1;

-- name: RegenerateInviteCode :one
UPDATE campaigns SET invite_code = $2 WHERE id = $1 RETURNING *;

-- name: JoinCampaign :exec
-- Add the user as a player; never downgrades an existing (e.g. DM) membership.
INSERT INTO memberships (user_id, campaign_id, role)
VALUES ($1, $2, 'player')
ON CONFLICT (user_id, campaign_id) DO NOTHING;

-- name: AddMembership :one
INSERT INTO memberships (user_id, campaign_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, campaign_id) DO UPDATE SET role = EXCLUDED.role
RETURNING *;

-- name: GetMembership :one
-- Used by role guards: returns the caller's role in a campaign, if any.
SELECT * FROM memberships WHERE user_id = $1 AND campaign_id = $2;

-- name: ListCampaignsForUser :many
-- Campaigns the user belongs to, with their per-campaign role.
SELECT c.*, m.role
FROM campaigns c
JOIN memberships m ON m.campaign_id = c.id
WHERE m.user_id = $1
ORDER BY c.created_at;
