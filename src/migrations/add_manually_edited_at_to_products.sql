-- Add manually_edited_at: when set, vendor sync must not overwrite this product.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS manually_edited_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

COMMENT ON COLUMN products.manually_edited_at IS 'Set when admin edits product; sync skips updating this product.';
