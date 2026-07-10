-- Level-up backbone: subclasses and feats join the content library, and
-- characters remember the choices a level-up makes.
ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'subclass';
ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'feat';

ALTER TABLE characters
    ADD COLUMN subclass_id UUID REFERENCES rules_content(id) ON DELETE SET NULL,
    ADD COLUMN feats TEXT[] NOT NULL DEFAULT '{}';
