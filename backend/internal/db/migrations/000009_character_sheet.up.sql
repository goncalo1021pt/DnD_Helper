-- Sheet fields for wizard-forged heroes. All nullable: legacy freeform
-- characters simply have no sheet until rebuilt through the wizard.
ALTER TABLE characters
    ADD COLUMN strength     SMALLINT,
    ADD COLUMN dexterity    SMALLINT,
    ADD COLUMN constitution SMALLINT,
    ADD COLUMN intelligence SMALLINT,
    ADD COLUMN wisdom       SMALLINT,
    ADD COLUMN charisma     SMALLINT,
    ADD COLUMN skills       TEXT[],
    ADD COLUMN class_id      UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    ADD COLUMN species_id    UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    ADD COLUMN background_id UUID REFERENCES rules_content(id) ON DELETE SET NULL;
