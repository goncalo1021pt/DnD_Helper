-- name: ListBestiaryEntries :many
-- Every sighting in a campaign, with the linked monster's data when
-- identified. Newest first; the creature's true name comes from content.
SELECT be.id, be.campaign_id, be.content_id, be.title, be.revealed,
       be.created_by, be.created_at,
       rc.name AS monster_name, rc.data AS monster_data
FROM bestiary_entries be
LEFT JOIN rules_content rc ON rc.id = be.content_id
WHERE be.campaign_id = $1
ORDER BY be.created_at DESC;

-- name: GetBestiaryEntry :one
SELECT be.id, be.campaign_id, be.content_id, be.title, be.revealed,
       be.created_by, be.created_at,
       rc.name AS monster_name, rc.data AS monster_data
FROM bestiary_entries be
LEFT JOIN rules_content rc ON rc.id = be.content_id
WHERE be.id = $1;

-- name: CreateBestiaryEntry :one
INSERT INTO bestiary_entries (campaign_id, title, created_by)
VALUES ($1, $2, $3)
RETURNING id;

-- name: UpdateBestiaryEntry :exec
UPDATE bestiary_entries
SET title = $2, content_id = $3, revealed = $4, updated_at = now()
WHERE id = $1;

-- name: DeleteBestiaryEntry :exec
DELETE FROM bestiary_entries WHERE id = $1;

-- name: ListBestiaryNotes :many
-- Field notes across a set of entries, oldest first, with the author's name.
SELECT bn.id, bn.entry_id, bn.author_id, bn.body, bn.created_at,
       u.name AS author_name
FROM bestiary_notes bn
LEFT JOIN users u ON u.id = bn.author_id
WHERE bn.entry_id = ANY($1::uuid[])
ORDER BY bn.created_at ASC;

-- name: AddBestiaryNote :one
INSERT INTO bestiary_notes (entry_id, author_id, body)
VALUES ($1, $2, $3)
RETURNING id;

-- name: GetBestiaryNote :one
SELECT * FROM bestiary_notes WHERE id = $1;

-- name: DeleteBestiaryNote :exec
DELETE FROM bestiary_notes WHERE id = $1;
