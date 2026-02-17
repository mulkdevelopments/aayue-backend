-- One-off: apply new tiered margin to existing product_variants and set products inactive when all variants have zero stock.
-- Tiered margin: vendorSalePrice > 1000 → 28%, 501–1000 → 37%, else 45%.
-- Run in psql or any PostgreSQL client.

-- Step 1: Update variant price and mrp from vendorsaleprice/vendormrp
WITH calc AS (
  SELECT
    id,
    vendorsaleprice,
    vendormrp,
    ROUND((vendorsaleprice::numeric) * (1 + (
      CASE
        WHEN (vendorsaleprice::numeric) > 1000 THEN 0.28
        WHEN (vendorsaleprice::numeric) >= 501 THEN 0.37
        ELSE 0.45
      END
    ))) AS new_price,
    CASE
      WHEN vendormrp IS NOT NULL AND (vendormrp::numeric) > (vendorsaleprice::numeric) THEN
        ROUND(
          (ROUND((vendorsaleprice::numeric) * (1 + (
            CASE
              WHEN (vendorsaleprice::numeric) > 1000 THEN 0.28
              WHEN (vendorsaleprice::numeric) >= 501 THEN 0.37
              ELSE 0.45
            END
          ))))
          / (1 - ((vendormrp::numeric - vendorsaleprice::numeric) / NULLIF(vendormrp::numeric, 0)))
        )
      ELSE
        ROUND((vendorsaleprice::numeric) * (1 + (
          CASE
            WHEN (vendorsaleprice::numeric) > 1000 THEN 0.28
            WHEN (vendorsaleprice::numeric) >= 501 THEN 0.37
            ELSE 0.45
          END
        )))
    END AS new_mrp
  FROM product_variants
  WHERE deleted_at IS NULL
    AND vendorsaleprice IS NOT NULL
    AND (vendorsaleprice::numeric) > 0
)
UPDATE product_variants v
SET price = c.new_price, mrp = c.new_mrp, updated_at = now()
FROM calc c
WHERE v.id = c.id;

-- Step 2: Set products inactive where all variants have zero stock
UPDATE products p
SET is_active = false, updated_at = now()
WHERE p.deleted_at IS NULL
  AND p.is_active = true
  AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL AND (v.stock IS NULL OR v.stock > 0));
