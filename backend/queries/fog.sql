-- name: GetPartyPool :one
SELECT * FROM knowledge_pools WHERE campaign_id = $1 AND is_party;

-- name: CreatePartyPool :one
INSERT INTO knowledge_pools (campaign_id, name, is_party)
VALUES ($1, 'The Party', true)
RETURNING *;

-- name: CreateRevealBatch :one
INSERT INTO reveal_batches (map_id, pool_id, note)
VALUES ($1, $2, $3)
RETURNING *;

-- name: AddRevealCircles :exec
INSERT INTO reveal_circles (batch_id, x, y, r)
SELECT $1, unnest($2::float8[]), unnest($3::float8[]), unnest($4::float8[]);

-- name: ListRevealBatches :many
-- The DM's ledger: every batch on a map with its size and pool.
SELECT b.id, b.note, b.created_at, p.name AS pool_name,
       count(c.id) AS circles
FROM reveal_batches b
JOIN knowledge_pools p ON p.id = b.pool_id
LEFT JOIN reveal_circles c ON c.batch_id = b.id
WHERE b.map_id = $1
GROUP BY b.id, p.name
ORDER BY b.created_at;

-- name: ListAllRevealCircles :many
-- Everything stamped on a map, any pool — the DM's rendering set.
SELECT c.x, c.y, c.r
FROM reveal_circles c
JOIN reveal_batches b ON b.id = c.batch_id
WHERE b.map_id = $1;

-- name: ListVisibleRevealCircles :many
-- A player's union: circles from the party pool plus any pool they were
-- explicitly seated in (stage 2's split parties ride this same query).
SELECT c.x, c.y, c.r
FROM reveal_circles c
JOIN reveal_batches b ON b.id = c.batch_id
JOIN knowledge_pools p ON p.id = b.pool_id
WHERE b.map_id = $1
  AND (p.is_party OR EXISTS (
        SELECT 1 FROM knowledge_pool_members m
        WHERE m.pool_id = p.id AND m.user_id = $2));

-- name: GetRevealBatch :one
-- A batch with its campaign, so handlers can gate on the DM role in one read.
SELECT b.id, b.map_id, mp.campaign_id
FROM reveal_batches b
JOIN maps mp ON mp.id = b.map_id
WHERE b.id = $1;

-- name: DeleteRevealBatch :execrows
DELETE FROM reveal_batches WHERE id = $1;
