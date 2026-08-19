-- Allies: the person who travels with the party (#228).
--
-- The paper practice is a line in the margin of the party page — "Sildar
-- travels with you to Phandalin" — present, marked, and removable, never
-- confused with a PC. #227 correctly took the Folk off the roster; this is
-- what puts one of them back beside it, deliberately and apart.
--
-- Three facts hang on the person rather than on a new table, because an ally
-- IS one of the Folk with a state, not a different kind of thing:
--
--   traveling        whether they walk with the party at all
--   hp_current       what they have left, for a person carried by a stat
--                    block. A sheet-backed ally keeps their hit points on the
--                    sheet, which is the one place that can hold them, so this
--                    stays NULL for them and NULL also means "untouched, at
--                    full" — the maximum is read off the block every time, the
--                    way a companion's is (rules/creatures.go).
--   control          who runs them: the DM alone, one named player, or the
--                    whole table. Control carries their numbers with it: you
--                    cannot play someone whose sheet you may not read.
--
-- Traveling implies the party knows they exist — an ally nobody has heard of
-- is a contradiction — so the handler opens that veil with the same stroke.
-- The stats veil is untouched: the party watches an ally's hit points fall
-- without necessarily being told what they can do.

ALTER TABLE npcs
    ADD COLUMN traveling       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN hp_current      INT,
    ADD COLUMN control         TEXT NOT NULL DEFAULT 'dm',
    ADD COLUMN control_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE npcs
    ADD CONSTRAINT npcs_control_shape CHECK (
        (control = 'player' AND control_user_id IS NOT NULL)
        OR (control IN ('dm', 'table') AND control_user_id IS NULL)
    );

CREATE INDEX idx_npcs_traveling ON npcs(campaign_id) WHERE traveling;

-- A combatant may now be one of the Folk. Like the other two references it is
-- a snapshot's origin, not its source of truth: the stats were copied in at
-- add time and stay put. What the link buys is the mirror — an ally's hit
-- points flow home when the fight moves them, exactly as a PC's do.
ALTER TABLE encounter_combatants
    ADD COLUMN npc_id UUID REFERENCES npcs(id) ON DELETE SET NULL;
