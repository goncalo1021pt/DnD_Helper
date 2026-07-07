-- name: UpsertSRDContent :one
INSERT INTO rules_content (kind, source, name, summary, data)
VALUES ($1, 'srd', $2, $3, $4)
ON CONFLICT (kind, source, name) DO UPDATE
SET summary = EXCLUDED.summary, data = EXCLUDED.data, updated_at = now()
RETURNING *;

-- name: ListContentByKind :many
SELECT * FROM rules_content WHERE kind = $1 ORDER BY source, name;

-- name: GetContent :one
SELECT * FROM rules_content WHERE id = $1;

-- name: CreateHomebrew :one
INSERT INTO rules_content (kind, source, name, summary, data, created_by)
VALUES ($1, 'homebrew', $2, $3, $4, $5)
RETURNING *;

-- name: UpdateContent :one
UPDATE rules_content
SET name = $2, summary = $3, data = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteContent :exec
DELETE FROM rules_content WHERE id = $1;
