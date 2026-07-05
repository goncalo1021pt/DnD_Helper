-- name: CreateTree :one
INSERT INTO skill_trees (campaign_id, name, description, keystone_pick_cost)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetTree :one
SELECT * FROM skill_trees WHERE id = $1;

-- name: ListTreesByCampaign :many
SELECT * FROM skill_trees WHERE campaign_id = $1 ORDER BY created_at;

-- name: UpdateTree :one
UPDATE skill_trees
SET name = $2, description = $3, keystone_pick_cost = $4
WHERE id = $1
RETURNING *;

-- name: DeleteTree :exec
DELETE FROM skill_trees WHERE id = $1;

-- name: CreateNode :one
INSERT INTO skill_nodes (tree_id, name, description, tradeoff, rarity, limb, is_entry, pos_x, pos_y)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetNode :one
SELECT * FROM skill_nodes WHERE id = $1;

-- name: ListNodesByTree :many
SELECT * FROM skill_nodes WHERE tree_id = $1 ORDER BY limb, created_at;

-- name: UpdateNode :one
UPDATE skill_nodes
SET name = $2, description = $3, tradeoff = $4, rarity = $5, limb = $6,
    is_entry = $7, pos_x = $8, pos_y = $9
WHERE id = $1
RETURNING *;

-- name: DeleteNode :exec
DELETE FROM skill_nodes WHERE id = $1;

-- name: ListEdgesByTree :many
SELECT * FROM skill_edges WHERE tree_id = $1;

-- name: DeleteEdgesForTree :exec
DELETE FROM skill_edges WHERE tree_id = $1;

-- name: AddEdge :exec
INSERT INTO skill_edges (tree_id, node_a, node_b)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetPact :one
SELECT * FROM character_trees WHERE character_id = $1;

-- name: SetPact :one
INSERT INTO character_trees (character_id, tree_id, picks_granted)
VALUES ($1, $2, 0)
ON CONFLICT (character_id) DO UPDATE
SET tree_id = EXCLUDED.tree_id,
    -- Re-pledging to the same tree keeps progress; a new tree resets it.
    picks_granted = CASE
        WHEN character_trees.tree_id = EXCLUDED.tree_id THEN character_trees.picks_granted
        ELSE 0
    END
RETURNING *;

-- name: GrantPicks :one
UPDATE character_trees
SET picks_granted = picks_granted + $2
WHERE character_id = $1
RETURNING *;

-- name: ListPickedNodes :many
SELECT n.* FROM character_nodes cn
JOIN skill_nodes n ON n.id = cn.node_id
WHERE cn.character_id = $1;

-- name: AddPick :exec
INSERT INTO character_nodes (character_id, node_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DeletePicksForCharacter :exec
DELETE FROM character_nodes WHERE character_id = $1;
