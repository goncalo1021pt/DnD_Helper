-- Homebrew is private per author, so names must only be unique per author —
-- two users can each have their own "Gunslinger", and a DM may admit either
-- or both to a campaign. SRD names stay unique per kind.
ALTER TABLE rules_content DROP CONSTRAINT rules_content_kind_source_name_key;

CREATE UNIQUE INDEX uniq_srd_content
    ON rules_content (kind, name) WHERE source = 'srd';
CREATE UNIQUE INDEX uniq_homebrew_per_author
    ON rules_content (kind, name, created_by) WHERE source = 'homebrew';
