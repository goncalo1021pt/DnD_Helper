-- Webhooks (#295): a person's standing order to be told, at a URL of their
-- choosing, when chosen events happen — and the deliveries that carry it out.
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    -- Event names from the catalogue; empty means every one.
    events TEXT[] NOT NULL,
    -- One table, or NULL for every table the person sits at.
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    -- NULL when born of a session. A hook born of a token records the token's
    -- scopes and may never hear an event the token could not have read.
    scopes TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Consecutive deliveries that died; at eight the hook is disabled.
    failures INT NOT NULL DEFAULT 0,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT
);
CREATE INDEX idx_webhooks_user ON webhooks(user_id, created_at DESC);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    -- The outbox row it carries; NULL for a ping.
    event_id UUID REFERENCES event_outbox(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- The body exactly as sent, so the log shows what the receiver saw.
    body JSONB NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    dead_at TIMESTAMPTZ,
    last_status INT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries(next_attempt_at)
    WHERE delivered_at IS NULL AND dead_at IS NULL;
CREATE INDEX idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at DESC);
