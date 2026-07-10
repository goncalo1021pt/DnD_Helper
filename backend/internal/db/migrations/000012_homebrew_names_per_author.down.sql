DROP INDEX IF EXISTS uniq_homebrew_per_author;
DROP INDEX IF EXISTS uniq_srd_content;
-- Best effort: fails if cross-author duplicates were created meanwhile.
ALTER TABLE rules_content ADD CONSTRAINT rules_content_kind_source_name_key
    UNIQUE (kind, source, name);
