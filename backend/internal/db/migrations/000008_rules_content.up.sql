-- Rules content backbone for the character builder. Content-as-data: the
-- repo seeds SRD 5.2 entries (CC-BY-4.0, see backend/internal/rules/ATTRIBUTION.md);
-- homebrew from owned books is added in-app and lives only in this instance.
CREATE TYPE content_kind AS ENUM ('class', 'species', 'background');
CREATE TYPE content_source AS ENUM ('srd', 'homebrew');

CREATE TABLE rules_content (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          content_kind NOT NULL,
    source        content_source NOT NULL DEFAULT 'homebrew',
    name          TEXT NOT NULL,
    summary       TEXT NOT NULL DEFAULT '',
    data          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL, -- null for srd
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kind, source, name)
);

CREATE INDEX idx_rules_content_kind ON rules_content(kind);
