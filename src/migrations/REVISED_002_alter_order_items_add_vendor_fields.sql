-- Add vendor order tracking columns
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS vendor_order_status VARCHAR(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS vendor_order_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vendor_reference_number VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tracking_codes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_order_items_vendor_status ON order_items(vendor_order_status);
CREATE INDEX IF NOT EXISTS idx_order_items_vendor_order_id ON order_items(vendor_order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tracking_codes ON order_items USING GIN (tracking_codes);

-- Add check constraint for valid status values
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_vendor_order_status;
ALTER TABLE order_items ADD CONSTRAINT chk_vendor_order_status
  CHECK (vendor_order_status IN ('pending', 'placed', 'failed'));


