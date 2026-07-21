-- name: CreateEncounter :one
INSERT INTO encounters (campaign_id, name)
VALUES ($1, $2)
RETURNING *;

-- name: ListEncounters :many
-- The DM's library: every encounter of a campaign, newest first, each with its
-- combatant count.
SELECT e.*, count(c.id) AS combatant_count
FROM encounters e
LEFT JOIN encounter_combatants c ON c.encounter_id = e.id
WHERE e.campaign_id = $1
GROUP BY e.id
ORDER BY e.created_at DESC;

-- name: GetEncounter :one
SELECT * FROM encounters WHERE id = $1;

-- name: GetActiveEncounter :one
SELECT * FROM encounters WHERE campaign_id = $1 AND status = 'active';

-- name: SetEncounterStatus :one
UPDATE encounters SET status = $2 WHERE id = $1 RETURNING *;

-- name: UpdateEncounterProgress :one
UPDATE encounters SET round = $2, turn_index = $3 WHERE id = $1 RETURNING *;

-- name: EndOtherActiveEncounters :exec
-- Only one encounter runs at a time: end any other active one before triggering.
UPDATE encounters SET status = 'ended'
WHERE campaign_id = $1 AND status = 'active' AND id <> $2;

-- name: DeleteEncounter :execrows
DELETE FROM encounters WHERE id = $1;

-- name: AddCombatant :one
INSERT INTO encounter_combatants (
    encounter_id, kind, content_id, character_id, label, player_label,
    init_mod, hp_current, hp_max, ac, hidden, sort_order
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: ListCombatants :many
-- Initiative order: highest initiative first, unrolled (NULL) last, then by
-- init modifier and add order to break ties.
SELECT * FROM encounter_combatants
WHERE encounter_id = $1
ORDER BY (initiative IS NULL), initiative DESC, init_mod DESC, sort_order, created_at;

-- name: GetCombatant :one
-- A combatant with its encounter's campaign, so handlers gate in one read.
SELECT c.*, e.campaign_id, e.status AS encounter_status
FROM encounter_combatants c
JOIN encounters e ON e.id = c.encounter_id
WHERE c.id = $1;

-- name: UpdateCombatant :one
UPDATE encounter_combatants
SET label = $2, player_label = $3, initiative = $4, hp_current = $5,
    hp_max = $6, ac = $7, hidden = $8
WHERE id = $1
RETURNING *;

-- name: SetCombatantInitiative :one
UPDATE encounter_combatants SET initiative = $2 WHERE id = $1 RETURNING *;

-- name: DeleteCombatant :execrows
DELETE FROM encounter_combatants WHERE id = $1;

-- name: RenameEncounter :one
UPDATE encounters SET name = $2 WHERE id = $1 RETURNING *;
