-- Admin-controlled tiered margin for vendor sync pricing.
-- Tiers: vendor sale price > high_threshold -> margin_high; >= mid_threshold -> margin_mid; else margin_low.
CREATE TABLE IF NOT EXISTS margin_settings (
  id INT PRIMARY KEY DEFAULT 1,
  high_threshold DECIMAL(12,2) NOT NULL DEFAULT 1000,
  mid_threshold DECIMAL(12,2) NOT NULL DEFAULT 501,
  margin_high_percent DECIMAL(5,2) NOT NULL DEFAULT 28,
  margin_mid_percent DECIMAL(5,2) NOT NULL DEFAULT 37,
  margin_low_percent DECIMAL(5,2) NOT NULL DEFAULT 45,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT margin_settings_single_row CHECK (id = 1)
);

INSERT INTO margin_settings (id, high_threshold, mid_threshold, margin_high_percent, margin_mid_percent, margin_low_percent)
VALUES (1, 1000, 501, 28, 37, 45)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE margin_settings IS 'Tiered margin % applied on vendor sale price during sync. Admin editable.';
