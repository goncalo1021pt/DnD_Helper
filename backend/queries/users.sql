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
