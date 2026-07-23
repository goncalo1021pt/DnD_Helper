-- Membership management: the DM Menu's roster, kicks, and bans.

-- name: ListMembers :many
-- Everyone at the table, DMs first, then players by seniority.
SELECT m.user_id, m.role, m.created_at, u.name, u.image
FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.campaign_id = $1
ORDER BY m.role, m.created_at;

-- name: DeleteMembership :execrows
DELETE FROM memberships WHERE user_id = $1 AND campaign_id = $2;

-- name: UnseatCharactersOfUser :exec
-- A kicked player's heroes go back to resting in My Heroes, never deleted.
UPDATE characters SET campaign_id = NULL
WHERE owner_user_id = $1 AND campaign_id = $2;

-- name: ReleaseQuestClaimsOfUser :exec
-- Free their claims on quests still in play; completed/failed stay as history.
DELETE FROM quest_claims qc
USING quests q
WHERE q.id = qc.quest_id
  AND qc.user_id = $1
  AND q.campaign_id = $2
  AND q.status IN ('available', 'active');

-- name: RemoveUserFromCampaignPools :exec
DELETE FROM knowledge_pool_members kpm
USING knowledge_pools kp
WHERE kp.id = kpm.pool_id
  AND kpm.user_id = $1
  AND kp.campaign_id = $2;

-- name: BanUser :exec
INSERT INTO campaign_bans (campaign_id, user_id)
VALUES ($1, $2)
ON CONFLICT (campaign_id, user_id) DO NOTHING;

-- name: UnbanUser :execrows
DELETE FROM campaign_bans WHERE campaign_id = $1 AND user_id = $2;

-- name: ListBans :many
SELECT b.user_id, b.banned_at, u.name, u.image
FROM campaign_bans b
JOIN users u ON u.id = b.user_id
WHERE b.campaign_id = $1
ORDER BY b.banned_at DESC;

-- name: IsBanned :one
SELECT EXISTS (
    SELECT 1 FROM campaign_bans WHERE campaign_id = $1 AND user_id = $2
) AS banned;
