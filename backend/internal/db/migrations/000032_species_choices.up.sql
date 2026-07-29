-- The picks a species asks for at creation — an Elf's lineage, a Gnome's
-- Forest-or-Rock, a Human's size. Stored as {choiceId: [option, ...]} rather
-- than as foreign keys: options are named inside the species entry, not rows
-- of their own, so a species edit can never orphan a hero.
ALTER TABLE characters
    ADD COLUMN species_choices JSONB NOT NULL DEFAULT '{}'::jsonb;
