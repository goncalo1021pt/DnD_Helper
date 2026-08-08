-- name: ListVendors :many
-- Every shop in a campaign, with the place it trades in. Redaction is the
-- handler's job — this hands over everything and the caller decides what the
-- viewer is allowed to see.
SELECT v.*, l.name AS location_name
FROM vendors v
LEFT JOIN locations l ON l.id = v.location_id
WHERE v.campaign_id = $1
ORDER BY l.name NULLS LAST, v.name;

-- name: GetVendor :one
SELECT * FROM vendors WHERE id = $1;

-- name: CreateVendor :one
INSERT INTO vendors (campaign_id, name, description, location_id, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateVendor :one
UPDATE vendors
SET name = $2, description = $3, location_id = $4, revealed = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteVendor :execrows
DELETE FROM vendors WHERE id = $1;

-- name: ListVendorStock :many
-- The shelves of one shop, in the order the DM arranged them. `mine` on the
-- joined content is not needed here: what a shop sells is the campaign's
-- business, not the author's.
SELECT s.*, rc.kind, rc.source, rc.summary, rc.data
FROM vendor_stock s
LEFT JOIN rules_content rc ON rc.id = s.content_id
WHERE s.vendor_id = $1
ORDER BY s.sort_order, s.created_at;

-- name: ListStockForCampaign :many
-- Every shelf in the campaign at once, so listing the shops does not become one
-- query per shop.
SELECT s.*, rc.kind, rc.source, rc.summary, rc.data
FROM vendor_stock s
JOIN vendors v ON v.id = s.vendor_id
LEFT JOIN rules_content rc ON rc.id = s.content_id
WHERE v.campaign_id = $1
ORDER BY s.sort_order, s.created_at;

-- name: GetStock :one
SELECT s.*, v.campaign_id
FROM vendor_stock s
JOIN vendors v ON v.id = s.vendor_id
WHERE s.id = $1;

-- name: AddStock :one
INSERT INTO vendor_stock (vendor_id, content_id, name, price, qty, sort_order)
VALUES ($1, $2, $3, $4, $5,
        COALESCE((SELECT MAX(sort_order) + 1 FROM vendor_stock WHERE vendor_id = $1), 0))
RETURNING *;

-- name: UpdateStock :one
UPDATE vendor_stock
SET price = $2, qty = $3, revealed = $4
WHERE id = $1
RETURNING *;

-- name: DeleteStock :execrows
DELETE FROM vendor_stock WHERE id = $1;

-- name: SellStock :one
-- One unit off the shelf. NULL qty is "as many as you like" and stays NULL;
-- no row back means the shelf emptied under the buyer's hand (sold out). The
-- UPDATE takes the row lock either way, so same-line buys serialize.
UPDATE vendor_stock
SET qty = CASE WHEN qty IS NULL THEN NULL ELSE qty - 1 END
WHERE id = $1 AND (qty IS NULL OR qty > 0)
RETURNING *;
