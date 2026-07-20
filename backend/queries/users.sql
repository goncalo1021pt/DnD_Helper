-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByProvider :one
SELECT * FROM users WHERE provider = $1 AND provider_id = $2;

-- name: UpsertUser :one
-- Create or update a user on OAuth login, keyed by (provider, provider_id).
INSERT INTO users (name, email, image, provider, provider_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (provider, provider_id) DO UPDATE
    SET name  = EXCLUDED.name,
        email = EXCLUDED.email,
        image = EXCLUDED.image
RETURNING *;

-- name: CreateLocalUser :one
-- Register a username+password account. Display name defaults to the username;
-- provider_id mirrors the lowercased username so (provider, provider_id) stays
-- meaningful and unique.
INSERT INTO users (name, username, email, password_hash, provider, provider_id)
VALUES ($1, $2, $3, $4, 'local', lower($2))
RETURNING *;

-- name: GetLocalUserByLogin :one
-- Sign-in lookup: match a local account by its username OR its email,
-- case-insensitively. Only accounts that carry a password can sign in this way.
SELECT * FROM users
WHERE provider = 'local'
  AND password_hash IS NOT NULL
  AND (lower(username) = lower($1) OR lower(email) = lower($1));
