-- Products: mark as suspicious when competitor name found in description (sync will not restore until recovered)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS suspicious_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspicious_reason TEXT DEFAULT NULL;

COMMENT ON COLUMN products.suspicious_at IS 'Set when sync detects blacklisted competitor name in description; product is also soft-deleted and inactive.';
COMMENT ON COLUMN products.suspicious_reason IS 'e.g. competitor name that was detected.';

-- Competitor blacklist: names to redact / flag in product descriptions (no insert/update from sync when found)
CREATE TABLE IF NOT EXISTS competitor_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE competitor_blacklist IS 'Competitor names to detect in product name/description on sync; matching products are marked suspicious, deleted, and inactive.';
