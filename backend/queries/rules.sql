-- name: UpsertSRDContent :one
INSERT INTO rules_content (kind, source, name, summary, data)
VALUES ($1, 'srd', $2, $3, $4)
ON CONFLICT (kind, name) WHERE source = 'srd' DO UPDATE
SET summary = EXCLUDED.summary, data = EXCLUDED.data, updated_at = now()
RETURNING *;

-- name: ListContentByKind :many
-- Everything the viewer may see: SRD, their own homebrew, and homebrew
-- enabled in a campaign they belong to.
SELECT rc.*, u.name AS creator_name
FROM rules_content rc
LEFT JOIN users u ON u.id = rc.created_by
WHERE rc.kind = $1
  AND (
    rc.source = 'srd'
    OR rc.created_by = $2
    OR EXISTS (
      SELECT 1
      FROM campaign_content cc
      JOIN memberships m ON m.campaign_id = cc.campaign_id
      WHERE cc.content_id = rc.id
        AND cc.status = 'enabled'
        AND m.user_id = $2
    )
  )
ORDER BY rc.source, rc.name;

-- name: ContentVisibleTo :one
-- The same visibility rule, for a single entry.
SELECT EXISTS (
  SELECT 1 FROM rules_content rc
  WHERE rc.id = $1
    AND (
      rc.source = 'srd'
      OR rc.created_by = $2
      OR EXISTS (
        SELECT 1
        FROM campaign_content cc
        JOIN memberships m ON m.campaign_id = cc.campaign_id
        WHERE cc.content_id = rc.id
          AND cc.status = 'enabled'
          AND m.user_id = $2
      )
    )
);

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
