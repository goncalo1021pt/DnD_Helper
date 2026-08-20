-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByIdentity :one
-- The account behind one door (#269). Sign-in is keyed here now rather than on
-- users, which is what lets one account answer to a password AND to Google.
SELECT u.* FROM users u
JOIN user_identities i ON i.user_id = u.id
WHERE i.provider = $1 AND i.provider_id = $2;

-- name: GetVerifiedUserByEmail :one
-- Who already holds this address, if they have PROVEN they hold it. Only a
-- verified account may be linked to: an unverified one may be a squatter
-- sitting on somebody else's address, and linking would hand them the account.
SELECT * FROM users
WHERE email_verified
  AND lower(nullif(trim(email), '')) = lower(trim($1));

-- name: GetAnyUserByEmail :one
-- Whoever holds this address, verified or not — for telling somebody why they
-- were turned away, never for letting them in.
SELECT * FROM users
WHERE lower(nullif(trim(email), '')) = lower(trim($1));

-- name: CreateOAuthUser :one
-- A brand-new account arriving through a provider. The provider vouches for
-- the address, so it lands verified.
INSERT INTO users (name, email, image, provider, provider_id, email_verified)
VALUES ($1, $2, $3, $4, $5, true)
RETURNING *;

-- name: LinkIdentity :one
-- Hang another door on an account. Re-linking one that is already there is a
-- no-op rather than an error, so a racing double callback cannot 500.
INSERT INTO user_identities (user_id, provider, provider_id)
VALUES ($1, $2, $3)
ON CONFLICT (provider, provider_id)
    DO UPDATE SET user_id = user_identities.user_id
RETURNING *;

-- name: RefreshOAuthProfile :one
-- What the provider tells us about somebody each time they come back. The
-- address is deliberately NOT touched: it is the account's identity now, one
-- account holds it, and a provider changing its mind must not silently move an
-- address off another account (or collide with it and fail the sign-in).
UPDATE users SET name = $2, image = $3 WHERE id = $1 RETURNING *;

-- name: AdoptEmail :one
-- Give a verified address to an account that has none. A provider vouches for
-- what it hands over, so an account that arrived without one (Discord without
-- an email scope, a dev login) gains it the first time one is offered.
UPDATE users SET email = $2, email_verified = true
WHERE id = $1 AND nullif(trim(email), '') IS NULL
RETURNING *;

-- name: CreateLocalUser :one
-- Register a username+password account. Display name defaults to the username;
-- provider_id mirrors the lowercased username so (provider, provider_id) stays
-- meaningful and unique.
-- The door is hung in the same statement: an account with no identity row
-- could never be signed in to, nor linked to later (#269).
WITH new_user AS (
    INSERT INTO users (name, username, email, password_hash, provider, provider_id)
    VALUES ($1, $2, $3, $4, 'local', lower($2))
    RETURNING *
), door AS (
    INSERT INTO user_identities (user_id, provider, provider_id)
    SELECT id, 'local', lower($2) FROM new_user
)
SELECT * FROM new_user;

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
-- For password recovery: a local account by verified-or-not email. Still
-- scoped to 'local' — recovery sets a PASSWORD, and only an account born with
-- one has a password to reset (#269 made the address unique, not the door).
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

-- name: GetSpentEmailToken :one
-- The same token in ANY state — a second click of an already-used link must
-- read as "already confirmed", not as a failure (#249).
SELECT * FROM email_tokens WHERE token_hash = $1;

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

-- name: CountUnusedRecoveryCodes :one
-- How many recovery codes a user has left. Read before clearing 2FA so the
-- operator is told what they are about to burn, and useful later for warning a
-- player that they are running out.
SELECT count(*) FROM twofa_recovery_codes
WHERE user_id = $1 AND used_at IS NULL;

-- name: RecordAdminAction :exec
-- The trail for something done to an account from a shell (#111).
INSERT INTO admin_actions (action, target_user_id, target_label, note)
VALUES ($1, $2, $3, $4);
