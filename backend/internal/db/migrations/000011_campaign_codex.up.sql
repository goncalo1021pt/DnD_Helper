-- The campaign codex: what content exists in a campaign's world.
-- Homebrew is private to its author until a DM enables it here; SRD is legal
-- by default but a DM may ban entries (down to "only custom classes" worlds).
CREATE TYPE codex_status AS ENUM ('proposed', 'enabled', 'banned');

CREATE TABLE campaign_content (
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    content_id  UUID NOT NULL REFERENCES rules_content(id) ON DELETE CASCADE,
    status      codex_status NOT NULL,
    proposed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, content_id)
);

CREATE INDEX idx_campaign_content_content ON campaign_content(content_id);
