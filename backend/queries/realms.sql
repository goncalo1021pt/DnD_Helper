-- name: ListRealms :many
-- The caller's own realms, with how many campaigns stand in each (#233).
-- Empty realms are listed too: an emptied realm is where the next campaign on
-- this ground begins, which is the whole point of the container outliving the
-- campaign.
SELECT r.*, (SELECT count(*) FROM campaigns c WHERE c.realm_id = r.id) AS campaign_count
FROM realms r
WHERE r.owner_user_id = $1
ORDER BY r.created_at;

-- name: GetRealm :one
SELECT * FROM realms WHERE id = $1;

-- name: CreateRealm :one
-- A realm is only ever born beside a campaign — either the one being founded
-- ("a realm of its own") or the one being moved out of a shared one. There is
-- no door for an empty realm, because a container with nothing in it is not a
-- thing anyone sets out to make.
INSERT INTO realms (name, owner_user_id) VALUES ($1, $2) RETURNING *;

-- name: RenameRealm :one
UPDATE realms SET name = $2, named = TRUE, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteRealm :execrows
-- Refuses while anything stands in it, which the FK would enforce anyway — but
-- a 500 is not an answer, so the handler counts first and this is the backstop.
DELETE FROM realms r
WHERE r.id = $1 AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.realm_id = r.id);

-- name: CountCampaignsInRealm :one
SELECT count(*) FROM campaigns WHERE realm_id = $1;

-- name: SetCampaignRealm :one
UPDATE campaigns SET realm_id = $2 WHERE id = $1 RETURNING *;

-- name: ListCampaignIDsByRealm :many
-- Every table standing on a realm — the fan-out for a change to shared
-- ground (#234): a place renamed or a road drawn must refresh every atlas
-- open on that realm, not only the one it was drawn from.
SELECT id FROM campaigns WHERE realm_id = $1;

-- name: TransferRealm :exec
-- The ground goes with the table when the table is alone on it (#299): a
-- campaign handed over takes its realm along, atlas and all, so a realm's
-- campaigns keep sharing one owner.
UPDATE realms SET owner_user_id = $2, updated_at = now() WHERE id = $1;
