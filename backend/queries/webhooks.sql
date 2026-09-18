-- Webhooks (#295): subscriptions and their deliveries.

-- name: CreateWebhook :one
INSERT INTO webhooks (user_id, url, secret, events, campaign_id, scopes)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListWebhooksByUser :many
SELECT w.*, c.name AS campaign_name,
    (SELECT max(d.delivered_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id)::timestamptz AS last_delivered_at
FROM webhooks w
LEFT JOIN campaigns c ON c.id = w.campaign_id
WHERE w.user_id = $1
ORDER BY w.created_at DESC;

-- name: GetWebhookForUser :one
SELECT w.*, c.name AS campaign_name,
    (SELECT max(d.delivered_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id)::timestamptz AS last_delivered_at
FROM webhooks w
LEFT JOIN campaigns c ON c.id = w.campaign_id
WHERE w.id = $1 AND w.user_id = $2;

-- name: CountWebhooksByUser :one
SELECT count(*) FROM webhooks WHERE user_id = $1;

-- name: DeleteWebhook :one
DELETE FROM webhooks WHERE id = $1 AND user_id = $2 RETURNING id;

-- name: EnableWebhook :exec
UPDATE webhooks SET disabled_at = NULL, disabled_reason = NULL, failures = 0
WHERE id = $1 AND user_id = $2;

-- The fan-out (#315 → #295): every live hook of anyone in the audience.
-- name: ListLiveWebhooksForUsers :many
SELECT * FROM webhooks
WHERE user_id = ANY($1::uuid[]) AND disabled_at IS NULL;

-- name: InsertWebhookDelivery :one
INSERT INTO webhook_deliveries (webhook_id, event_id, name, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- The worker's claim: due, not done, on a live hook, locked so a second
-- worker (there is none today) could never send the same one twice.
-- name: ClaimDueWebhookDeliveries :many
SELECT d.*, w.url, w.secret, w.user_id
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
