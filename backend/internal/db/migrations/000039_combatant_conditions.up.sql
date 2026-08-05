-- Conditions and death saves on the tracker (#173).
--
-- A combatant carried initiative, HP, AC and hidden — everything about where it
-- stands in the order, and nothing about what is happening to it. At a real
-- table the tracker's job is exactly the part that was missing: who is
-- poisoned, who is concentrating, and who is bleeding out on the floor.

-- The conditions riding on this combatant, by canonical name ("Poisoned",
-- "Exhaustion 3"). A plain text array rather than a join table or an enum: the
-- vocabulary is a closed list of fifteen that the 2024 rules already fix, it is
-- read on every single tracker paint and written a few times a fight, and it is
-- never queried across combatants. Validation lives in Go (internal/http/
-- conditions.go) for the same reason encounter status does — a CHECK constraint
-- would turn a typo into a 500 instead of a 400.
ALTER TABLE encounter_combatants
    ADD COLUMN conditions TEXT[] NOT NULL DEFAULT '{}';

-- Death saves. Three successes stabilise, three failures kill; a hero back
-- above 0 hit points is no longer dying at all, which is why UpdateCombatant
-- resets both the moment hp_current rises (see queries/encounters.sql).
--
-- These belong to player characters. Monsters in this app die when their hit
-- points do, and the API refuses to set pips on anything that is not a `pc`.
ALTER TABLE encounter_combatants
    ADD COLUMN death_save_successes SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN death_save_failures  SMALLINT NOT NULL DEFAULT 0;
