-- name: AddCharacterSpells :exec
-- Add spell picks; re-adding an existing spell is a no-op.
INSERT INTO character_spells (character_id, content_id)
SELECT $1, unnest($2::uuid[])
ON CONFLICT DO NOTHING;

-- name: ListCharacterSpells :many
-- A hero's spells with their content and author, cantrips first.
SELECT rc.*, u.name AS creator_name
FROM character_spells cs
JOIN rules_content rc ON rc.id = cs.content_id
LEFT JOIN users u ON u.id = rc.created_by
WHERE cs.character_id = $1
ORDER BY (rc.data->>'level')::int, rc.name;

-- name: ListCharacterContentRefs :many
-- Every rules reference a hero carries beyond the sheet columns:
-- spell picks and content-backed inventory rows (for codex checks).
SELECT cs.content_id FROM character_spells cs WHERE cs.character_id = $1
UNION
SELECT ci.content_id FROM character_items ci
WHERE ci.character_id = $1 AND ci.content_id IS NOT NULL;

-- name: AddCharacterItem :one
INSERT INTO character_items (character_id, content_id, name, qty)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetCharacterItem :one
SELECT * FROM character_items WHERE id = $1;

-- name: UpdateCharacterItem :one
UPDATE character_items
SET qty = $2, equipped = $3, slot = $4
WHERE id = $1
RETURNING *;

-- name: DeleteCharacterItem :exec
DELETE FROM character_items WHERE id = $1;

-- name: ListCharacterItems :many
-- Inventory with live content; a snapshot name covers deleted content.
SELECT ci.id, ci.character_id, ci.content_id, ci.qty, ci.equipped, ci.slot,
       COALESCE(rc.name, ci.name) AS name,
       rc.kind, rc.source, rc.summary, rc.data, rc.created_by,
       u.name AS creator_name
FROM character_items ci
LEFT JOIN rules_content rc ON rc.id = ci.content_id
LEFT JOIN users u ON u.id = rc.created_by
WHERE ci.character_id = $1
ORDER BY ci.equipped DESC, ci.created_at ASC;

-- name: UnequipItems :exec
-- Stows a set of rows: equip flag off, slot vacated.
UPDATE character_items
SET equipped = false, slot = ''
WHERE character_id = $1 AND id = ANY($2::uuid[]);
