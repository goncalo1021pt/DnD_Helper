-- name: CreateEncounter :one
INSERT INTO encounters (campaign_id, name, tag, location_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListEncounters :many
-- The DM's library: every encounter of a campaign, newest first, each with its
-- combatant count and the name of the place it is filed under.
SELECT e.*, count(c.id) AS combatant_count, l.name AS location_name
FROM encounters e
LEFT JOIN encounter_combatants c ON c.encounter_id = e.id
LEFT JOIN locations l ON l.id = e.location_id
WHERE e.campaign_id = $1
GROUP BY e.id, l.name
ORDER BY e.created_at DESC;

-- name: FileEncounter :one
-- Where an encounter belongs: a session tag, a place, both, or neither. Full
-- replacement — the caller sends the filing it wants, not a patch of it.
UPDATE encounters SET tag = $2, location_id = $3 WHERE id = $1 RETURNING *;

-- name: GetEncounter :one
SELECT * FROM encounters WHERE id = $1;

-- name: ListActiveEncounters :many
-- Every fight currently running in a campaign. More than one is normal: a party
-- that splits is two encounters at once.
SELECT * FROM encounters
WHERE campaign_id = $1 AND status = 'active'
ORDER BY created_at DESC;

-- name: GetActiveEncounterForUser :one
-- The running fight this player's hero is standing in. A player only ever
-- watches their own battle — the other half of a split party is not their
-- business — so the join runs through their own characters.
SELECT DISTINCT ON (e.id) e.*
FROM encounters e
JOIN encounter_combatants c ON c.encounter_id = e.id
JOIN characters ch ON ch.id = c.character_id
WHERE e.campaign_id = $1 AND e.status = 'active' AND ch.owner_user_id = $2
ORDER BY e.id, e.created_at DESC
LIMIT 1;

-- name: ListActiveCombatantsForCharacter :many
-- Every live combatant row for one hero. Used to mirror HP into whichever fight
-- they're in, and to refuse seating them in a second one.
SELECT c.* FROM encounter_combatants c
JOIN encounters e ON e.id = c.encounter_id
WHERE c.character_id = $1 AND e.status = 'active';

-- name: SetEncounterStatus :one
UPDATE encounters SET status = $2 WHERE id = $1 RETURNING *;

-- name: UpdateEncounterProgress :one
UPDATE encounters SET round = $2, turn_index = $3 WHERE id = $1 RETURNING *;

-- name: StandDownEncounters :many
-- Send every running fight in a campaign back to inactive at once. The DM's
-- panic button: with several fights open, hunting down which one still holds a
-- player is exactly the chore this avoids.
UPDATE encounters SET status = 'inactive', round = 1, turn_index = 0
WHERE campaign_id = $1 AND status = 'active'
RETURNING *;

-- name: ClearEncounterParty :exec
-- Standing down releases the heroes. Monsters stay, so the encounter is still a
-- prepared fight the DM can trigger again; the party is summoned fresh each run.
DELETE FROM encounter_combatants WHERE encounter_id = $1 AND kind = 'pc';

-- name: ClearEncounterInitiative :exec
-- Initiative belongs to a running fight and nothing else. It must not survive
-- into the builder, where a stale order would look like a rolled one.
UPDATE encounter_combatants SET initiative = NULL WHERE encounter_id = $1;

-- name: DeleteEncounter :execrows
DELETE FROM encounters WHERE id = $1;

-- name: AddCombatant :one
INSERT INTO encounter_combatants (
    encounter_id, kind, content_id, character_id, label, player_label,
    init_mod, hp_current, hp_max, ac, hidden, sort_order, group_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: ListCombatants :many
-- Initiative order: highest initiative first, unrolled (NULL) last, then by
-- init modifier and add order to break ties. Members of a group always land
-- side by side (they share an initiative and a group_id, and coalescing to the
-- row's own id keeps loners sorting exactly as they did before) — the tracker
-- collapses each run of them into a single entry, so they must never interleave
-- with another combatant that happened to roll the same number.
SELECT * FROM encounter_combatants
WHERE encounter_id = $1
ORDER BY (initiative IS NULL), initiative DESC, init_mod DESC,
         COALESCE(group_id, id), sort_order, created_at;

-- name: SetGroupInitiative :exec
-- A group acts as one creature, so its members share a single roll.
UPDATE encounter_combatants SET initiative = $2
WHERE encounter_id = $1 AND group_id = $3;

-- name: DeleteCombatantGroup :execrows
-- Remove a whole mob at once.
DELETE FROM encounter_combatants WHERE encounter_id = $1 AND group_id = $2;

-- name: GetCombatant :one
-- A combatant with its encounter's campaign, so handlers gate in one read.
SELECT c.*, e.campaign_id, e.status AS encounter_status
FROM encounter_combatants c
JOIN encounters e ON e.id = c.encounter_id
WHERE c.id = $1;

-- name: UpdateCombatant :one
-- Healing a hero above 0 ends their death saves, so the reset rides on the
-- write that raises the hit points rather than on the handler that asked for
-- it. Every path that lifts a combatant off the floor goes through here — the
-- DM's + button, and the Party roster mirroring back through syncSeatedHero —
-- and a rule enforced in one of those two places is a rule that holds half the
-- time. Conditions are deliberately untouched: being healed does not cure
-- poison, and this query runs on every roster sync.
UPDATE encounter_combatants
SET label = $2, player_label = $3, initiative = $4, hp_current = $5,
    hp_max = $6, ac = $7, hidden = $8,
    death_save_successes = CASE WHEN $5::int > 0 THEN 0 ELSE death_save_successes END,
    death_save_failures  = CASE WHEN $5::int > 0 THEN 0 ELSE death_save_failures  END
WHERE id = $1
RETURNING *;

-- name: SetCombatantConditions :one
-- The conditions a combatant is under, in full. A replacement rather than an
-- add/remove pair: the DM's editor holds the whole set and the list is at most
-- fifteen long, so sending it whole costs nothing and spares us a merge that
-- two people toggling at once would lose either way.
UPDATE encounter_combatants SET conditions = $2 WHERE id = $1 RETURNING *;

-- name: SetCombatantDeathSaves :one
-- Pips only. Kept off UpdateCombatant so it cannot collide with the reset
-- above: the handler refuses to set these on a combatant that is not at 0 hit
-- points, which is the only state in which they mean anything.
UPDATE encounter_combatants
SET death_save_successes = $2, death_save_failures = $3
WHERE id = $1
RETURNING *;

-- name: SetCombatantInitiative :one
UPDATE encounter_combatants SET initiative = $2 WHERE id = $1 RETURNING *;

-- name: DeleteCombatant :execrows
DELETE FROM encounter_combatants WHERE id = $1;

-- name: RenameEncounter :one
UPDATE encounters SET name = $2 WHERE id = $1 RETURNING *;
