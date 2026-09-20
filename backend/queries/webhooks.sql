-- Webhooks (#295): subscriptions and their deliveries.

-- name: CreateWebhook :one
INSERT INTO webhooks (user_id, url, secret, events, campaign_id, scopes, format)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListWebhooksByUser :many
SELECT w.*, c.name AS campaign_name,
    (SELECT max(d.delivered_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id)::timestamptz AS last_delivered_at
FROM webhooks w
LEFT JOIN campaigns c ON c.id = w.campaign_id
WHERE w.user_id = sqlc.arg(user_id)::uuid
ORDER BY w.created_at DESC;

-- name: GetWebhookForUser :one
SELECT w.*, c.name AS campaign_name,
    (SELECT max(d.delivered_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id)::timestamptz AS last_delivered_at
FROM webhooks w
LEFT JOIN campaigns c ON c.id = w.campaign_id
WHERE w.id = $1 AND w.user_id = sqlc.arg(user_id)::uuid;

-- name: CountWebhooksByUser :one
SELECT count(*) FROM webhooks WHERE user_id = sqlc.arg(user_id)::uuid;

-- name: DeleteWebhook :one
DELETE FROM webhooks WHERE id = $1 AND user_id = sqlc.arg(user_id)::uuid RETURNING id;

-- name: EnableWebhook :exec
UPDATE webhooks SET disabled_at = NULL, disabled_reason = NULL, failures = 0
WHERE id = $1 AND user_id = sqlc.arg(user_id)::uuid;

-- The fan-out (#315 → #295): every live hook of anyone in the audience.
-- A table's own channel has no owner and is never selected here.
-- name: ListLiveWebhooksForUsers :many
SELECT * FROM webhooks
WHERE user_id = ANY($1::uuid[]) AND disabled_at IS NULL;

-- The table's own channel (#316): a hook with no owner, selected by the
-- table it hangs on rather than by the audience.
-- name: ListLiveTableChannels :many
SELECT * FROM webhooks
WHERE campaign_id = $1 AND user_id IS NULL AND disabled_at IS NULL;

-- name: GetTableChannel :one
SELECT w.*, c.name AS campaign_name,
    (SELECT max(d.delivered_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id)::timestamptz AS last_delivered_at
FROM webhooks w
LEFT JOIN campaigns c ON c.id = w.campaign_id
WHERE w.campaign_id = $1 AND w.user_id IS NULL;

-- Setting the channel again replaces the URL and the names and gives a
-- disabled one another chance, since a DM pasting a fresh URL means it.
-- name: UpsertTableChannel :one
INSERT INTO webhooks (user_id, url, secret, events, campaign_id, format)
VALUES (NULL, $1, $2, $3, $4, 'discord')
ON CONFLICT (campaign_id) WHERE user_id IS NULL DO UPDATE
SET url = EXCLUDED.url, events = EXCLUDED.events,
    disabled_at = NULL, disabled_reason = NULL, failures = 0
RETURNING *;

-- name: DeleteTableChannel :execrows
DELETE FROM webhooks WHERE campaign_id = $1 AND user_id IS NULL;

-- name: InsertWebhookDelivery :one
INSERT INTO webhook_deliveries (webhook_id, event_id, name, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- The worker's claim: due, not done, on a live hook, locked so a second
-- worker (there is none today) could never send the same one twice.
-- name: ClaimDueWebhookDeliveries :many
SELECT d.*, w.url, w.secret, w.user_id, w.campaign_id, w.format
FROM webhook_deliveries d
JOIN webhooks w ON w.id = d.webhook_id
WHERE d.delivered_at IS NULL AND d.dead_at IS NULL AND d.next_attempt_at <= now()
  AND w.disabled_at IS NULL
ORDER BY d.next_attempt_at
LIMIT $1
FOR UPDATE OF d SKIP LOCKED;

-- name: MarkWebhookDelivered :exec
UPDATE webhook_deliveries
SET delivered_at = now(), attempts = attempts + 1, last_status = $2, last_error = NULL
WHERE id = $1;

-- name: MarkWebhookDeliveryFailed :exec
UPDATE webhook_deliveries
SET attempts = attempts + 1, next_attempt_at = $2, last_status = $3, last_error = $4
WHERE id = $1;

-- name: MarkWebhookDeliveryDead :exec
UPDATE webhook_deliveries
SET attempts = attempts + 1, dead_at = now(), last_status = $2, last_error = $3
WHERE id = $1;

-- name: ListWebhookDeliveries :many
SELECT * FROM webhook_deliveries
WHERE webhook_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: RecordWebhookSuccess :exec
UPDATE webhooks SET failures = 0 WHERE id = $1;

-- name: RecordWebhookDeadDelivery :one
UPDATE webhooks SET failures = failures + 1 WHERE id = $1 RETURNING failures;

-- name: DisableWebhook :exec
UPDATE webhooks SET disabled_at = now(), disabled_reason = $2
WHERE id = $1 AND disabled_at IS NULL;
