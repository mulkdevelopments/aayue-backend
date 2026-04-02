-- Hero slide curated collections: each slide can have a collection_slug and 20+ hand-picked products.
-- Shop Now links to /shop/curated/{collection_slug} to show those products.

ALTER TABLE hero_slides
  ADD COLUMN IF NOT EXISTS collection_slug VARCHAR(255) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hero_slides_collection_slug
  ON hero_slides(collection_slug) WHERE collection_slug IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN hero_slides.collection_slug IS 'Slug for curated collection (e.g. timeless-modern-wardrobe). When set, Shop Now shows products from hero_slide_products.';

CREATE TABLE IF NOT EXISTS hero_slide_products (
  hero_slide_id UUID NOT NULL REFERENCES hero_slides(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  PRIMARY KEY (hero_slide_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_hero_slide_products_hero_slide ON hero_slide_products(hero_slide_id);
CREATE INDEX IF NOT EXISTS idx_hero_slide_products_sort ON hero_slide_products(hero_slide_id, sort_order);

COMMENT ON TABLE hero_slide_products IS 'Hand-picked products per hero slide (20+ per collection). Order by sort_order.';
