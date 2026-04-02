-- 1) DEDUPE: Remove duplicate products (same vendor_id + productid). Keeps one per group (most recent updated_at).
-- Run once in a single session. Uses temp table so all DELETEs see the same duplicate set.
-- Deletes in dependency order: cart_items, order_items, media, product_variants, products.

-- Build list of product ids to remove (duplicates; keeper = row with latest updated_at per vendor_id+productid)
DROP TABLE IF EXISTS products_to_dedupe_delete;
CREATE TEMP TABLE products_to_dedupe_delete AS
SELECT id
FROM (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY vendor_id, productid
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM products
  WHERE deleted_at IS NULL AND productid IS NOT NULL
) AS dupes
WHERE rn > 1;

-- 1a) Remove cart_items for variants of duplicate products
DELETE FROM cart_items
WHERE variant_id IN (
  SELECT pv.id FROM product_variants pv
  INNER JOIN products_to_dedupe_delete t ON t.id = pv.product_id
);

-- 1b) Remove order_items for those variants
DELETE FROM order_items
WHERE variant_id IN (
  SELECT pv.id FROM product_variants pv
  INNER JOIN products_to_dedupe_delete t ON t.id = pv.product_id
);

-- 1c) Remove media for those variants
DELETE FROM media
WHERE variant_id IN (
  SELECT pv.id FROM product_variants pv
  INNER JOIN products_to_dedupe_delete t ON t.id = pv.product_id
);

-- 1d) Delete variants of duplicate products
DELETE FROM product_variants
WHERE product_id IN (SELECT id FROM products_to_dedupe_delete);

-- 1e) Delete duplicate products
DELETE FROM products
WHERE id IN (SELECT id FROM products_to_dedupe_delete);

DROP TABLE IF EXISTS products_to_dedupe_delete;


-- 2) PREVENT: Unique constraint so (vendor_id, productid) cannot repeat (only where productid is set).
-- Run after dedupe. Ignore if the index already exists.
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_vendor_productid
  ON products (vendor_id, productid)
  WHERE deleted_at IS NULL AND productid IS NOT NULL;
