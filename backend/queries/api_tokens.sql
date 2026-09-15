-- API tokens (#294). The secret never touches the database: every query keys
-- on its hash.

-- name: CreateAPIToken :one
INSERT INTO api_tokens (user_id, name, prefix, token_hash, scopes, campaign_id, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListAPITokensByUser :many
SELECT t.*, c.name AS campaign_name
FROM api_tokens t
LEFT JOIN campaigns c ON c.id = t.campaign_id
WHERE t.user_id = $1 AND t.revoked_at IS NULL
ORDER BY t.created_at DESC;

-- name: CountLiveAPITokensByUser :one
SELECT count(*) FROM api_tokens
WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());

-- The one lookup the bearer loader makes: a revoked or expired token is no row.
-- name: GetLiveAPITokenByHash :one
SELECT * FROM api_tokens
WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());

-- Written at most once a minute per token, so a busy script costs one UPDATE
-- rather than one per request.
-- name: TouchAPIToken :exec
UPDATE api_tokens SET last_used_at = now()
WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

-- The ceiling badge (#314): written at most once a minute, like last_used_at.
-- name: ThrottleAPIToken :exec
UPDATE api_tokens SET throttled_at = now()
WHERE id = $1 AND (throttled_at IS NULL OR throttled_at < now() - interval '1 minute');

-- name: RevokeAPIToken :one
UPDATE api_tokens SET revoked_at = now()
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
RETURNING id;
