-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByProvider :one
SELECT * FROM users WHERE provider = $1 AND provider_id = $2;

-- name: UpsertUser :one
-- Create or update a user on OAuth login, keyed by (provider, provider_id).
-- The provider vouches for the address, so OAuth users are always verified.
INSERT INTO users (name, email, image, provider, provider_id, email_verified)
VALUES ($1, $2, $3, $4, $5, true)
ON CONFLICT (provider, provider_id) DO UPDATE
    SET name           = EXCLUDED.name,
        email          = EXCLUDED.email,
        image          = EXCLUDED.image,
        email_verified = true
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

-- name: SetEmailVerified :exec
UPDATE users SET email_verified = true WHERE id = $1;

-- name: SetPassword :exec
UPDATE users SET password_hash = $2 WHERE id = $1;

-- name: GetLocalUserByEmail :one
-- For password recovery: a local account by verified-or-not email.
SELECT * FROM users
WHERE provider = 'local' AND lower(email) = lower($1);

-- name: CreateEmailToken :one
INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetEmailToken :one
-- A live token by its hash: not expired, not yet spent.
SELECT * FROM email_tokens
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now();

-- name: UseEmailToken :exec
UPDATE email_tokens SET used_at = now() WHERE id = $1;

-- name: InvalidateUserTokens :exec
-- Spend any outstanding tokens of one purpose for a user (e.g. after a reset).
UPDATE email_tokens SET used_at = now()
WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL;

-- name: SetTOTPSecret :exec
-- Store a freshly-generated (not-yet-confirmed) encrypted secret during setup.
UPDATE users SET totp_secret = $2, totp_enabled = false WHERE id = $1;

-- name: EnableTOTP :exec
UPDATE users SET totp_enabled = true WHERE id = $1;

-- name: DisableTOTP :exec
UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1;

-- name: AddRecoveryCode :exec
INSERT INTO twofa_recovery_codes (user_id, code_hash) VALUES ($1, $2);

-- name: GetRecoveryCode :one
-- A still-usable recovery code for a user, by its hash.
SELECT * FROM twofa_recovery_codes
WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL;

-- name: UseRecoveryCode :exec
UPDATE twofa_recovery_codes SET used_at = now() WHERE id = $1;

-- name: DeleteRecoveryCodes :exec
DELETE FROM twofa_recovery_codes WHERE user_id = $1;
