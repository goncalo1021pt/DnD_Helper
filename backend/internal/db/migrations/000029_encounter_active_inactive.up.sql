-- Encounters have two states, not three. "draft" and "ended" were the same
-- thing wearing different hats — a fight that isn't running — and the split
-- leaked: an ended encounter still carried its party and its initiative, so
-- reopening it showed heroes seated in a fight nobody triggered.
--
-- And more than one may run at once. A party that splits in two is two fights
-- on the board at the same time, so the "one active per campaign" unique index
-- goes away.

DROP INDEX IF EXISTS idx_encounters_one_active;

UPDATE encounters SET status = 'inactive' WHERE status <> 'active';

ALTER TABLE encounters ALTER COLUMN status SET DEFAULT 'inactive';
ALTER TABLE encounters ADD CONSTRAINT encounters_status_check
    CHECK (status IN ('inactive', 'active'));

-- Still worth an index — "which fights are running" is read on every campaign
-- view — just no longer a unique one.
CREATE INDEX idx_encounters_active ON encounters(campaign_id) WHERE status = 'active';

-- A seated hero is now looked up the other way round: given a character, which
-- running fight are they in? That drives both the player's view of their own
-- battle and the guard against summoning someone into two fights at once.
CREATE INDEX idx_combatants_character ON encounter_combatants(character_id)
    WHERE character_id IS NOT NULL;
