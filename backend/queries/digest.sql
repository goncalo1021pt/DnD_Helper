-- The daily digest (#339): events held, then sent as one message.

-- name: InsertDigestItem :exec
INSERT INTO digest_items (user_id, webhook_id, campaign_id, event_id, name, line, due_at)
VALUES (sqlc.narg(user_id), sqlc.narg(webhook_id), $1, sqlc.narg(event_id), $2, $3, $4);

-- Who has something due by email. A confirmed address and no pending deletion
-- are re-read here, because they may have changed since the line was held.
-- name: ListUsersWithDueDigest :many
SELECT DISTINCT u.id, u.email
FROM digest_items i
JOIN users u ON u.id = i.user_id
WHERE i.due_at <= now()
  AND u.email IS NOT NULL AND u.email <> '' AND u.email_verified
  AND u.deletion_requested_at IS NULL;

-- name: ClaimEmailDigest :many
WITH due AS (
    DELETE FROM digest_items i
    WHERE i.user_id = $1 AND i.due_at <= now()
    RETURNING i.campaign_id, i.line, i.created_at
)
SELECT c.id AS campaign_id, c.name AS campaign_name, d.line, d.created_at
FROM due d JOIN campaigns c ON c.id = d.campaign_id
ORDER BY c.name, d.created_at;

-- Items due for people who can no longer be mailed are dropped, not kept.
-- name: DropUnmailableDigest :exec
DELETE FROM digest_items i
USING users u
WHERE i.user_id = u.id AND i.due_at <= now()
  AND (u.email IS NULL OR u.email = '' OR NOT u.email_verified OR u.deletion_requested_at IS NOT NULL);

-- name: ListWebhooksWithDueDigest :many
SELECT DISTINCT w.id
FROM digest_items i
JOIN webhooks w ON w.id = i.webhook_id
WHERE i.due_at <= now() AND w.disabled_at IS NULL;

-- name: ClaimHookDigest :many
WITH due AS (
    DELETE FROM digest_items i
    WHERE i.webhook_id = $1 AND i.due_at <= now()
    RETURNING i.campaign_id, i.line, i.created_at
)
SELECT c.id AS campaign_id, c.name AS campaign_name, d.line, d.created_at
FROM due d JOIN campaigns c ON c.id = d.campaign_id
ORDER BY c.name, d.created_at;

-- A hook disabled with items waiting forgets them.
-- name: DropDisabledHookDigest :exec
DELETE FROM digest_items i USING webhooks w
WHERE i.webhook_id = w.id AND w.disabled_at IS NOT NULL;

-- name: InsertWebhookDigestDelivery :one
INSERT INTO webhook_deliveries (webhook_id, name, body, carries)
VALUES ($1, 'digest', $2, $3)
RETURNING *;

-- Changing the hour moves what is waiting.
-- name: RescheduleUserDigest :exec
UPDATE digest_items SET due_at = $2 WHERE user_id = $1 AND due_at > now();

-- A name taken out of the digest takes its waiting lines with it.
-- name: PruneUserDigest :exec
DELETE FROM digest_items WHERE user_id = $1 AND NOT (name = ANY($2::text[]));

-- name: RescheduleHookDigest :exec
UPDATE digest_items SET due_at = $2 WHERE webhook_id = $1;

-- name: DeleteUserDigest :exec
DELETE FROM digest_items WHERE user_id = $1;

-- The dev door (APP_ENV != production): everything waiting is due now.
-- name: MakeAllDigestsDue :exec
UPDATE digest_items SET due_at = now() - interval '1 second';

-- name: SetEmailDigest :exec
UPDATE users SET email_events = $2, email_digest_events = $3, digest_hour = $4 WHERE id = $1;
