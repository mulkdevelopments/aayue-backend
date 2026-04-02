-- Run once if brand_highlights is missing (also appended in migrationFiles.js).
CREATE TABLE IF NOT EXISTS brand_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name VARCHAR(255) NOT NULL,
  display_label VARCHAR(255),
  image_url TEXT NOT NULL,
  link_url VARCHAR(1024),
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_highlights_active ON brand_highlights(active);
CREATE INDEX IF NOT EXISTS idx_brand_highlights_sort ON brand_highlights(sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_highlights_brand_alive
  ON brand_highlights (lower(trim(brand_name)))
  WHERE deleted_at IS NULL;
