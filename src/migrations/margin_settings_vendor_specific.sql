-- Make margin_settings vendor-specific. vendor_id NULL = default (used when no vendor-specific row).
ALTER TABLE margin_settings DROP CONSTRAINT IF EXISTS margin_settings_single_row;
ALTER TABLE margin_settings ADD COLUMN IF NOT EXISTS vendor_id UUID NULL REFERENCES vendors(id) ON DELETE CASCADE;

-- Ensure at most one "default" row (vendor_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS margin_settings_vendor_id_key ON margin_settings (vendor_id) WHERE vendor_id IS NOT NULL;
-- Allow only one "default" row (vendor_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS margin_settings_default_one ON margin_settings ((vendor_id IS NULL)) WHERE vendor_id IS NULL;

-- Migrate existing row to default (vendor_id NULL)
UPDATE margin_settings SET vendor_id = NULL WHERE id = 1;

COMMENT ON COLUMN margin_settings.vendor_id IS 'NULL = default margin for all vendors; else margin for this vendor only.';
