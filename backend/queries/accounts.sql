-- Account deletion (#322). The schedule is a column; the purge is a handful of
-- statements run in one transaction by internal/accounts, which anonymises the
-- users row in place rather than deleting it, so everything that points at it
-- keeps working.

-- name: RequestAccountDeletion :one
-- Schedules the deletion, or reports the date already scheduled: asking twice
-- must not push the day back.
UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, now())
WHERE id = $1 AND deleted_at IS NULL
RETURNING deletion_requested_at;

-- name: CancelAccountDeletion :execrows
-- Signing in again is the whole of cancelling. One row if it was pending.
UPDATE users SET deletion_requested_at = NULL
WHERE id = $1 AND deletion_requested_at IS NOT NULL AND deleted_at IS NULL;

-- name: RevokeAPITokensOfUser :exec
-- A scheduled account's tokens stop at once; cancelling does not bring them back.
UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: ListCampaignsOwnedBy :many
-- What blocks a deletion: a table you own is handed over or disbanded first.
SELECT id, name FROM campaigns WHERE owner_user_id = $1 ORDER BY name;

-- name: ListUsersDueForPurge :many
SELECT id FROM users
WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL
  AND deletion_requested_at < $1
ORDER BY deletion_requested_at
LIMIT $2;

-- name: LockUserForPurge :one
-- Two sweeps (or a sweep and the operator) must not purge one account twice.
SELECT id, email, email_verified FROM users
WHERE id = $1 AND deleted_at IS NULL AND deletion_requested_at IS NOT NULL
FOR UPDATE SKIP LOCKED;

-- name: ListMembershipCampaignsOfUser :many
SELECT campaign_id FROM memberships WHERE user_id = $1;

-- name: HandBodiesToOwners :exec
-- The Folk's bodies a co-DM forged are the table's, not theirs: they pass to
-- the campaign's owner before the DM's heroes are struck.
UPDATE characters c SET owner_user_id = ca.owner_user_id
FROM campaigns ca
WHERE c.owner_user_id = $1 AND c.kind = 'npc' AND ca.id = c.campaign_id;

-- name: ReturnAlliesToDM :exec
-- An ally the departing player ran goes back to the DM.
UPDATE npcs SET control = 'dm', control_user_id = NULL WHERE control_user_id = $1;

-- name: DeleteCharactersOfUser :exec
DELETE FROM characters WHERE owner_user_id = $1;

-- name: DeleteRealmsOfUser :exec
DELETE FROM realms WHERE owner_user_id = $1;

-- name: DeleteIdentitiesOfUser :exec
DELETE FROM user_identities WHERE user_id = $1;

-- name: DeleteEmailTokensOfUser :exec
DELETE FROM email_tokens WHERE user_id = $1;

-- name: DeleteAPITokensOfUser :exec
DELETE FROM api_tokens WHERE user_id = $1;

-- name: DeleteWebhooksOfUser :exec
DELETE FROM webhooks WHERE user_id = $1;

-- name: DeleteFriendshipsOfUser :exec
DELETE FROM friendships WHERE requester_id = $1 OR addressee_id = $1;

-- name: DeleteBlocksOfUser :exec
DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1;

-- name: DeleteDirectReadsOfUser :exec
DELETE FROM direct_reads WHERE user_id = $1 OR peer_id = $1;

-- name: DeletePartyReadsOfUser :exec
DELETE FROM party_reads WHERE user_id = $1;

-- name: DeleteBansOfUser :exec
DELETE FROM campaign_bans WHERE user_id = $1;

-- name: DeleteUnadmittedHomebrewOf :exec
-- Homebrew a table admitted stays, anonymised by its author's tombstone —
-- heroes at that table are built from it. The rest goes, unless a hero's class
-- row still points at it (character_classes.class_id is RESTRICT).
DELETE FROM rules_content rc
WHERE rc.created_by = $1
  AND NOT EXISTS (SELECT 1 FROM campaign_content cc WHERE cc.content_id = rc.id AND cc.status = 'enabled')
  AND NOT EXISTS (SELECT 1 FROM character_classes k WHERE k.class_id = rc.id);

-- name: ScrubUser :exec
-- The tombstone: the row stays so history keeps its foreign keys, with nothing
-- personal on it. provider_id takes the row's own id because (provider,
-- provider_id) is unique; the friend-tag trigger redraws the digits only if
-- another departed player already wears them.
UPDATE users SET
    name = 'a departed player',
    email = NULL, email_verified = false, image = NULL,
    provider = 'departed', provider_id = id::text,
    username = NULL, password_hash = NULL,
    totp_secret = NULL, totp_enabled = false,
    email_events = NULL, name_chosen = true,
    deleted_at = now(), deletion_requested_at = NULL
WHERE id = $1;

-- name: CountRecentEmailTokens :one
-- The throttle on a link that sends mail: one is enough a minute.
SELECT count(*) FROM email_tokens
WHERE user_id = $1 AND purpose = $2 AND created_at > $3;

-- name: IsPendingDeletion :one
SELECT (deletion_requested_at IS NOT NULL)::boolean FROM users WHERE id = $1;

-- name: FindLiveUserForOperator :one
-- The operator's lookup: any account that is not already a tombstone, by
-- username or address. An address names one account (idx_users_email).
SELECT * FROM users
WHERE deleted_at IS NULL
  AND (lower(username) = lower($1) OR lower(email) = lower($1))
LIMIT 1;

-- name: CountCharactersOfUser :one
SELECT count(*) FROM characters WHERE owner_user_id = $1 AND kind = 'hero';
