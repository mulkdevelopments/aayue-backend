-- =============================================================
-- Performance indexes for filter/facet queries with lakhs of products
--
-- Run with: psql -d ecommerce -f add_filter_performance_indexes.sql
-- All indexes use CONCURRENTLY to avoid table locks in production.
-- =============================================================

-- ── product_our_category_map ─────────────────────────────────
-- Most critical: every facet query joins through this table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pom_catid_prodid
  ON product_our_category_map(our_category_id, product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pom_prodid
  ON product_our_category_map(product_id);

-- ── products ─────────────────────────────────────────────────
-- Partial index on active products (skips soft-deleted / inactive rows)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active
  ON products(id)
  WHERE deleted_at IS NULL AND is_active = true;

-- Brand facets: group-by on brand_name_normalized
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_brand_norm
  ON products(brand_name_normalized)
  WHERE deleted_at IS NULL AND is_active = true
    AND brand_name_normalized IS NOT NULL;

-- Gender facets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_gender_lc
  ON products(lower(gender))
  WHERE deleted_at IS NULL AND is_active = true
    AND gender IS NOT NULL AND trim(gender) <> '';

-- Vendor-id for the vendor-active EXISTS check
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_vendor_id
  ON products(vendor_id)
  WHERE deleted_at IS NULL AND is_active = true
    AND vendor_id IS NOT NULL;

-- ── product_variants ─────────────────────────────────────────
-- Base join: product_id with soft-delete filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pv_prodid_active
  ON product_variants(product_id)
  WHERE deleted_at IS NULL;

-- Price range aggregations & price filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pv_prodid_price
  ON product_variants(product_id, price)
  WHERE deleted_at IS NULL;

-- Color facets (normalized_color used in CROSS JOIN LATERAL tokenization)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pv_prodid_color
  ON product_variants(product_id, normalized_color)
  WHERE deleted_at IS NULL
    AND normalized_color IS NOT NULL;

-- Size facets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pv_prodid_size
  ON product_variants(product_id, normalized_size_final)
  WHERE deleted_at IS NULL
    AND normalized_size_final IS NOT NULL;

-- ── categories ───────────────────────────────────────────────
-- Recursive parent traversal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_parent
  ON categories(parent_id)
  WHERE deleted_at IS NULL;

-- Slug lookup for search-scoped category resolution
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_slug_our
  ON categories(slug)
  WHERE is_our_category = true AND deleted_at IS NULL;

-- ── vendors ──────────────────────────────────────────────────
-- EXISTS check for active vendor in every facet query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendors_active
  ON vendors(id)
  WHERE status = 'active' AND deleted_at IS NULL;

-- ── ANALYZE ──────────────────────────────────────────────────
-- Update statistics so the planner uses the new indexes immediately.
ANALYZE product_our_category_map;
ANALYZE products;
ANALYZE product_variants;
ANALYZE categories;
ANALYZE vendors;
