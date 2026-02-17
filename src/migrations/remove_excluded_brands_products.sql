-- Hard-delete products (and their variants) for excluded brands: dolls, aesop, floyd.
-- Deletes in dependency order so foreign keys are satisfied.
-- Run once after deploying the excluded-brands sync logic.

-- 1) Remove cart items that reference variants of excluded-brand products
DELETE FROM cart_items
WHERE variant_id IN (
  SELECT pv.id FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE p.brand_name_normalized IN ('dolls', 'aesop', 'floyd')
);

-- 2) Remove order line items that reference these variants (so we can delete variants)
DELETE FROM order_items
WHERE variant_id IN (
  SELECT pv.id FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE p.brand_name_normalized IN ('dolls', 'aesop', 'floyd')
);

-- 3) Remove media that reference these variants (media.variant_id FK)
DELETE FROM media
WHERE variant_id IN (
  SELECT pv.id FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE p.brand_name_normalized IN ('dolls', 'aesop', 'floyd')
);

-- 4) Delete variants (inventory_transactions have ON DELETE CASCADE from variant_id)
DELETE FROM product_variants
WHERE product_id IN (
  SELECT id FROM products
  WHERE brand_name_normalized IN ('dolls', 'aesop', 'floyd')
);

-- 5) Delete products (product_categories, product_dynamic_filters, best_sellers, new_arrivals etc. CASCADE from product_id)
DELETE FROM products
WHERE brand_name_normalized IN ('dolls', 'aesop', 'floyd');
