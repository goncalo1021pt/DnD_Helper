-- Attunement (#189).
--
-- The 2024 rules let a hero bond with at most three magic items, and the app
-- had nowhere to write the bond down. It is a fact about the ROW, not the
-- content: two heroes owning the same Frost Brand attune separately, and a
-- stack of three rings on one row is one bond, the same way a stack equipped
-- in a hand fights as one weapon. Independent of equipped — stowing a ring
-- does not break the bond, and the rules agree. The cap of three is enforced
-- by the handler, where the refusal can say why.
ALTER TABLE character_items ADD COLUMN attuned BOOLEAN NOT NULL DEFAULT false;
