-- name: CreateRevealBatch :one
-- A stamp session. `party_id` is the label the ledger reads back; who may see
-- the ground is decided by reveal_batch_heroes alone (#232).
INSERT INTO reveal_batches (map_id, note, location_id, party_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: AddRevealBatchHeroes :exec
-- The heroes standing in the party at the moment of the stamp. None means the
-- whole table, exactly as an empty override list does everywhere else.
INSERT INTO reveal_batch_heroes (batch_id, character_id)
SELECT $1, unnest($2::uuid[])
ON CONFLICT DO NOTHING;

-- name: AddRevealCircles :exec
INSERT INTO reveal_circles (batch_id, x, y, r)
SELECT $1, unnest($2::float8[]), unnest($3::float8[]), unnest($4::float8[]);

-- name: ListRevealBatches :many
-- The DM's ledger: every batch on a map with its size, who it was stamped for,
-- and the place whose veil gates it (null when the heroes alone decide).
SELECT b.id, b.note, b.created_at,
       coalesce(pt.name, '')::text AS party_name,
       (SELECT count(*) FROM reveal_batch_heroes h WHERE h.batch_id = b.id) AS hero_count,
       b.location_id, coalesce(l.name, '')::text AS location_name,
       count(c.id) AS circles
FROM reveal_batches b
LEFT JOIN parties pt ON pt.id = b.party_id
LEFT JOIN locations l ON l.id = b.location_id
LEFT JOIN reveal_circles c ON c.batch_id = b.id
WHERE b.map_id = $1
GROUP BY b.id, pt.name, l.name
ORDER BY b.created_at;

-- name: ListAllRevealCircles :many
-- Everything stamped on a map, for anybody — the DM's rendering set.
SELECT c.x, c.y, c.r
FROM reveal_circles c
JOIN reveal_batches b ON b.id = c.batch_id
WHERE b.map_id = $1;

-- name: ListVisibleRevealCircles :many
-- A player's candidate set: circles stamped for the whole table, plus any
-- stamped while one of this viewer's own heroes was standing there (#232).
-- Keyed by CHARACTER, like every other veil in the app — fog used to be the
-- lone exception, keyed by user.
--
-- The place a circle hangs in comes back with it — the second gate, the veil
-- over that place, is resolved in Go against the viewer's own heroes, because
-- that rule already lives there and walks ancestors (see visibility.go).
SELECT c.x, c.y, c.r, b.location_id
FROM reveal_circles c
JOIN reveal_batches b ON b.id = c.batch_id
WHERE b.map_id = $1
  AND (NOT EXISTS (SELECT 1 FROM reveal_batch_heroes h WHERE h.batch_id = b.id)
       OR EXISTS (SELECT 1 FROM reveal_batch_heroes h
                  WHERE h.batch_id = b.id AND h.character_id = ANY($2::uuid[])));

-- name: GetRevealBatch :one
-- A batch with its campaign, so handlers can gate on the DM role in one read.
SELECT b.id, b.map_id, b.location_id, mp.campaign_id
FROM reveal_batches b
JOIN maps mp ON mp.id = b.map_id
WHERE b.id = $1;

-- name: SetRevealBatchLocation :one
-- Re-tie a batch to a place, or cut it loose (null) back to the heroes' rule.
UPDATE reveal_batches SET location_id = $2 WHERE id = $1 RETURNING *;

-- name: DeleteRevealBatch :execrows
DELETE FROM reveal_batches WHERE id = $1;
