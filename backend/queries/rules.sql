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

-- name: PruneSRDContent :exec
-- The seed is authoritative for SRD rows: entries dropped from the seed
-- (e.g. content that turned out not to be in the SRD) are removed.
DELETE FROM rules_content
WHERE kind = $1 AND source = 'srd' AND NOT (name = ANY($2::text[]));

-- name: UpsertOwnHomebrew :one
-- Import upsert: create the author's entry or update it in place, keyed on
-- the per-author uniqueness (kind, name, created_by).
INSERT INTO rules_content (kind, source, name, summary, data, created_by)
VALUES ($1, 'homebrew', $2, $3, $4, $5)
ON CONFLICT (kind, name, created_by) WHERE source = 'homebrew' DO UPDATE
SET summary = EXCLUDED.summary, data = EXCLUDED.data, updated_at = now()
RETURNING *, (xmax = 0) AS created;

-- name: ListOwnHomebrew :many
SELECT * FROM rules_content
WHERE source = 'homebrew' AND created_by = $1
ORDER BY kind, name;

-- name: HomebrewImpact :many
-- Per-kind counts of the caller's homebrew and what references it: how many
-- entries sit on the caller's own characters, on other players' characters
-- (via spell/item picks and the class/species/subclass/background links), and
-- how many are admitted in a campaign codex. DISTINCT keeps the cross-joins
-- from inflating the tallies.
WITH mine AS (
    SELECT id, kind FROM rules_content
    WHERE source = 'homebrew' AND created_by = $1
),
refs AS (
    SELECT cs.content_id AS id, ch.owner_user_id AS owner
    FROM character_spells cs JOIN characters ch ON ch.id = cs.character_id
    UNION ALL
    SELECT ci.content_id, ch.owner_user_id
    FROM character_items ci JOIN characters ch ON ch.id = ci.character_id
    WHERE ci.content_id IS NOT NULL
    UNION ALL
    SELECT ch.class_id, ch.owner_user_id FROM characters ch WHERE ch.class_id IS NOT NULL
    UNION ALL
    SELECT ch.species_id, ch.owner_user_id FROM characters ch WHERE ch.species_id IS NOT NULL
    UNION ALL
    SELECT ch.subclass_id, ch.owner_user_id FROM characters ch WHERE ch.subclass_id IS NOT NULL
    UNION ALL
    SELECT ch.background_id, ch.owner_user_id FROM characters ch WHERE ch.background_id IS NOT NULL
),
ref_by_id AS (
    SELECT id,
        bool_or(owner = $1) AS by_me,
        bool_or(owner <> $1) AS by_others
    FROM refs GROUP BY id
),
codex AS (
    SELECT DISTINCT content_id AS id FROM campaign_content
)
SELECT
    m.kind,
    count(*)::int AS total,
    count(*) FILTER (WHERE rb.by_me)::int AS on_my_characters,
    count(*) FILTER (WHERE rb.by_others)::int AS on_others_characters,
    count(*) FILTER (WHERE cx.id IS NOT NULL)::int AS in_campaigns
FROM mine m
LEFT JOIN ref_by_id rb ON rb.id = m.id
LEFT JOIN codex cx ON cx.id = m.id
GROUP BY m.kind
ORDER BY m.kind;

-- name: DeleteOwnHomebrew :execrows
-- Wipe every homebrew entry the caller authored. FK cascades handle the
-- fallout: spell picks vanish, item rows degrade to free text, character
-- class/species/subclass/background links and bestiary links null out, and
-- codex rulings drop.
DELETE FROM rules_content
WHERE source = 'homebrew' AND created_by = $1;

-- name: DeleteOwnHomebrewByKind :execrows
DELETE FROM rules_content
WHERE source = 'homebrew' AND created_by = $1 AND kind = $2;

-- name: DeleteOwnHomebrewByBook :execrows
-- Undo one imported pack: wipe the caller's homebrew stamped with that book.
DELETE FROM rules_content
WHERE source = 'homebrew' AND created_by = $1
  AND data->>'book' = sqlc.arg(book)::text;

-- name: HomebrewBooks :many
-- The imported-packs shelf: the caller's homebrew grouped by source book,
-- one row per (book, kind). book is NULL for hand-scribed entries.
SELECT coalesce(data->>'book', '')::text AS book, kind, count(*) AS total
FROM rules_content
WHERE source = 'homebrew' AND created_by = $1
GROUP BY data->>'book', kind
ORDER BY data->>'book' NULLS LAST, kind;
