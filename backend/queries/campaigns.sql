-- name: CreateCampaign :one
INSERT INTO campaigns (name, owner_user_id, invite_code, realm_id)
VALUES ($1, $2, $3, $4)
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
-- Campaigns the user belongs to, with their per-campaign role and the realm
-- they stand in (#233). The realm's NAME rides along for everyone, DM and
-- player alike: a table knowing the name of its setting is not a secret, and
-- it is the only way a player ever learns it. Who may LIST, rename, move or
-- strike a realm is a separate question, and the answer is its owner.
SELECT c.*, m.role, r.name AS realm_name
FROM campaigns c
JOIN memberships m ON m.campaign_id = c.id
JOIN realms r ON r.id = c.realm_id
WHERE m.user_id = $1
ORDER BY c.created_at;

-- name: SetNextSession :one
UPDATE campaigns SET next_session_at = $2 WHERE id = $1 RETURNING *;

-- name: SetProgression :one
UPDATE campaigns SET progression = $2 WHERE id = $1 RETURNING *;

-- name: SetMaxLevel :one
UPDATE campaigns SET max_level = $2 WHERE id = $1 RETURNING *;

-- name: SetMaxSeatedPerPlayer :one
UPDATE campaigns SET max_seated_per_player = $2 WHERE id = $1 RETURNING *;

-- name: SetHiddenSheets :one
-- Draw or lift the veil over the table's character sheets.
UPDATE campaigns SET hidden_sheets = $2 WHERE id = $1 RETURNING *;

-- name: DeleteCampaign :exec
-- Everything scoped to the campaign cascades: memberships, quests, skill
-- trees, codex rulings, chronicle events, bestiary notes, maps, encounters,
-- bans, and seat requests. Characters are handled separately beforehand —
-- table-born ones die with the table, seated heroes are unseated first.
DELETE FROM campaigns WHERE id = $1;

-- name: SetCoinage :one
-- The coins a table counts in (#195). NULL puts it back on the standard ladder.
UPDATE campaigns SET coinage = $2 WHERE id = $1 RETURNING *;

-- name: TransferCampaign :one
-- Hand the table to another member (#299). Ownership is a separate fact from
-- the DM role: the owner is one of the DMs, and holds the doors that reshape
-- or end the table — disband, the realm, and this.
UPDATE campaigns SET owner_user_id = $2 WHERE id = $1 RETURNING *;
