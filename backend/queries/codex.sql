-- name: ListCodex :many
-- Every codex row for a campaign, with its content and proposer.
SELECT cc.content_id, cc.status, cc.created_at,
       rc.kind, rc.source, rc.name, rc.summary, rc.data, rc.created_by,
       u.name AS proposer_name
FROM campaign_content cc
JOIN rules_content rc ON rc.id = cc.content_id
LEFT JOIN users u ON u.id = cc.proposed_by
WHERE cc.campaign_id = $1
ORDER BY rc.kind, rc.name;

-- name: SetCodexStatus :exec
-- DM verdicts: enable homebrew, ban/unban SRD, approve proposals.
INSERT INTO campaign_content (campaign_id, content_id, status, proposed_by)
VALUES ($1, $2, $3, $4)
ON CONFLICT (campaign_id, content_id)
DO UPDATE SET status = EXCLUDED.status;

-- name: DeleteCodexEntry :exec
-- Back to the default: SRD legal, homebrew invisible.
DELETE FROM campaign_content WHERE campaign_id = $1 AND content_id = $2;

-- name: ProposeCodexContent :exec
-- A member offers their homebrew to the table; never downgrades a DM verdict.
INSERT INTO campaign_content (campaign_id, content_id, status, proposed_by)
VALUES ($1, $2, 'proposed', $3)
ON CONFLICT (campaign_id, content_id) DO NOTHING;

-- name: GetCodexStatuses :many
-- Statuses for a set of entries in one campaign (seat/level-up legality).
SELECT content_id, status FROM campaign_content
WHERE campaign_id = $1 AND content_id = ANY($2::uuid[]);

-- name: SetCodexStatusBulk :exec
-- One DM verdict over many entries at once (pack admissions).
INSERT INTO campaign_content (campaign_id, content_id, status, proposed_by)
SELECT $1, unnest($2::uuid[]), $3, $4
ON CONFLICT (campaign_id, content_id)
DO UPDATE SET status = EXCLUDED.status;
