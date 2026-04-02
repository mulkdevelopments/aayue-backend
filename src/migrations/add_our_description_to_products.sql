-- Our storefront description: AI-rewritten from vendor description (THE DETAILS style).
ALTER TABLE products ADD COLUMN IF NOT EXISTS our_description TEXT;
COMMENT ON COLUMN products.our_description IS 'AI-rewritten product description for storefront (narrative + highlights). Null = not yet written.';
