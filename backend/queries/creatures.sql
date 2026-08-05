-- name: ListCharacterCreatures :many
-- A hero's forms and companions, each with the library entry behind it. The
-- row's own name is kept (not coalesced away) — a renamed companion outranks
-- the stat block it was built from.
SELECT cc.*,
       rc.name AS content_name, rc.summary AS content_summary,
       rc.data AS content_data, rc.source AS content_source
FROM character_creatures cc
LEFT JOIN rules_content rc ON rc.id = cc.content_id
WHERE cc.character_id = $1
ORDER BY cc.role, cc.created_at;

-- name: GetCharacterCreature :one
SELECT * FROM character_creatures WHERE id = $1;

-- name: AddCharacterCreature :one
INSERT INTO character_creatures (
    character_id, role, content_id, name, granted_by, overrides, notes
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateCharacterCreature :one
UPDATE character_creatures
SET name       = $2,
    overrides  = $3,
    hp_current = $4,
    active     = $5,
    notes      = $6,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteCharacterCreature :exec
DELETE FROM character_creatures WHERE id = $1;

-- name: DeactivateCharacterForms :exec
-- One shape at a time: assuming a form drops whatever the hero was wearing.
UPDATE character_creatures
SET active = false, updated_at = now()
WHERE character_id = $1 AND role = 'form' AND id <> $2 AND active;

-- name: ListMonstersForCreatures :many
-- The stat blocks a hero may draw a creature from: SRD plus the viewer's own
-- homebrew. Deliberately NOT the Den's query — this one is reachable by
-- players, and the handler narrows it to what their features actually grant.
SELECT * FROM rules_content
WHERE kind = 'monster' AND (source = 'srd' OR created_by = $1)
ORDER BY name;
